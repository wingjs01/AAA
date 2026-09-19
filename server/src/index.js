/**
 * 單字吊人 — LINE Bot 後端（Cloudflare Worker）
 *
 * 路由：
 *   POST /line/webhook   LINE 事件入口
 *   POST /api/liff       用 LIFF idToken 換取使用者資料
 *   GET  /api/decks      取得題庫清單（?t=<web_token>）
 *   GET  /api/deck/:id   取得題庫內的單字
 */
import { parseCommand, parseWordLines, normalizeWord, normalizeDeckName } from './parse.js';
import * as LINE from './line.js';
import * as DB from './db.js';
import { extractFromImage, cleanResult } from './extract.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      if (url.pathname === '/line/webhook' && request.method === 'POST') {
        return await handleWebhook(request, env, ctx);
      }
      if (url.pathname === '/api/liff' && request.method === 'POST') {
        return await handleLiff(request, env);
      }
      if (url.pathname === '/api/decks') {
        return await handleDecks(url, env);
      }
      if (url.pathname.startsWith('/api/deck/')) {
        return await handleDeckWords(url, env);
      }
      if (url.pathname.startsWith('/ocr/')) {
        return await handleOcrApi(url, request, env);
      }
      if (url.pathname === '/health') {
        return json({ ok: true });
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      console.error('unhandled', err && err.stack);
      return json({ error: 'internal error' }, 500);
    }
  }
};

/* ========================= LINE Webhook ========================= */

async function handleWebhook(request, env, ctx) {
  const bodyText = await request.text();
  const sig = request.headers.get('x-line-signature');

  const valid = await LINE.verifySignature(env.LINE_CHANNEL_SECRET, bodyText, sig);
  if (!valid) return new Response('invalid signature', { status: 401 });

  const body = JSON.parse(bodyText);
  const events = Array.isArray(body.events) ? body.events : [];

  // LINE 要求 webhook 盡快回 200，實際處理放到背景
  ctx.waitUntil(Promise.all(events.map((e) => handleEvent(e, env).catch((err) => {
    console.error('event failed', err && err.stack);
    if (e.replyToken) {
      return LINE.reply(env.LINE_CHANNEL_ACCESS_TOKEN, e.replyToken,
        '處理時發生問題：' + (err.message || '未知錯誤'));
    }
  }))));

  return new Response('OK');
}

async function handleEvent(event, env) {
  if (event.type === 'follow') {
    const user = await DB.ensureUser(env.DB, event.source.userId, '');
    return LINE.reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, welcomeText(env, user));
  }
  if (event.type !== 'message') return;

  const userId = event.source && event.source.userId;
  if (!userId) return;

  const profile = await LINE.getProfile(env.LINE_CHANNEL_ACCESS_TOKEN, userId);
  const user = await DB.ensureUser(env.DB, userId, profile ? profile.displayName : '');

  if (event.message.type === 'text') {
    const text = await handleTextMessage(event.message.text, user, env);
    return LINE.reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, text);
  }

  if (event.message.type === 'image') {
    const out = await handleImageMessage(event.message.id, user, env, event.replyToken);
    // 走本地 OCR 時先不佔用 replyToken，留給辨識完成後的回覆
    if (out && out.defer) {
      return LINE.push(env.LINE_CHANNEL_ACCESS_TOKEN, user.line_user_id, out.text);
    }
    return LINE.reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, out);
  }

  return LINE.reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken,
    '我只看得懂文字和圖片喔。輸入 /說明 看用法。');
}

/* ========================= 文字訊息 ========================= */

export async function handleTextMessage(text, user, env) {
  const cmd = parseCommand(text);
  if (cmd) return runCommand(cmd, user, env);
  return addWordsFromText(text, user, env);
}

export async function runCommand(cmd, user, env) {
  const db = env.DB;

  switch (cmd.cmd) {
    case 'help':
      return helpText();

    case 'decks': {
      const decks = await DB.listDecks(db, user.line_user_id);
      if (!decks.length) return '你還沒有任何題庫。\n\n用「/新增 課本第一課」建立第一個。';
      const lines = decks.map((d) =>
        `${d.id === user.current_deck_id ? '▶ ' : '　 '}${d.name}（${d.word_count} 字）`);
      return '你的題庫：\n' + lines.join('\n') + '\n\n▶ 是目前收單字的題庫\n切換：/切換 題庫名稱';
    }

    case 'new': {
      const chk = normalizeDeckName(cmd.arg);
      if (chk.error) return chk.error;
      const { deck, created } = await DB.createDeck(db, user.line_user_id, chk.name);
      await DB.setCurrentDeck(db, user.line_user_id, deck.id);
      return created
        ? `已建立題庫「${chk.name}」並切換過去。\n\n現在直接把單字傳給我就會收進這個題庫：\n\napple 蘋果\nbanana 香蕉\n\n也可以直接拍課本照片傳過來。`
        : `「${chk.name}」已經存在，已切換過去。`;
    }

    case 'switch': {
      const chk = normalizeDeckName(cmd.arg);
      if (chk.error) return '請指定要切換的題庫，例如：/切換 課本第一課';
      const deck = await DB.getDeckByName(db, user.line_user_id, chk.name);
      if (!deck) return `找不到題庫「${chk.name}」。\n用 /題庫 看看有哪些。`;
      await DB.setCurrentDeck(db, user.line_user_id, deck.id);
      return `已切換到「${chk.name}」。`;
    }

    case 'remove': {
      const chk = normalizeDeckName(cmd.arg);
      if (chk.error) return '請指定要刪除的題庫，例如：/刪除 課本第一課';
      const deck = await DB.getDeckByName(db, user.line_user_id, chk.name);
      if (!deck) return `找不到題庫「${chk.name}」。`;
      const words = await DB.listWords(db, deck.id);
      await DB.deleteDeck(db, user.line_user_id, deck.id);
      return `已刪除題庫「${chk.name}」和裡面的 ${words.length} 個單字。`;
    }

    case 'list': {
      if (!user.current_deck_id) return '還沒有選定題庫。用 /題庫 看清單，或 /新增 建一個。';
      const deck = await DB.getDeck(db, user.current_deck_id);
      const words = await DB.listWords(db, user.current_deck_id);
      if (!words.length) return `「${deck.name}」目前是空的。把單字傳給我就會收進去。`;
      const shown = words.slice(0, 50).map((w, i) =>
        `${i + 1}. ${w.word}${w.zh ? '　' + w.zh : ''}`).join('\n');
      const more = words.length > 50 ? `\n…還有 ${words.length - 50} 個` : '';
      return `「${deck.name}」共 ${words.length} 個單字：\n\n${shown}${more}`;
    }

    case 'unword': {
      if (!user.current_deck_id) return '還沒有選定題庫。';
      const chk = normalizeWord(cmd.arg);
      if (chk.error) return '請指定要移除的單字，例如：/移除 apple';
      const done = await DB.removeWord(db, user.current_deck_id, chk.word);
      return done ? `已從目前題庫移除「${chk.word}」。` : `目前題庫裡沒有「${chk.word}」。`;
    }

    case 'quiz': {
      const decks = await DB.listDecks(db, user.line_user_id);
      const usable = decks.filter((d) => d.word_count > 0);
      if (!usable.length) {
        return '還沒有可以測驗的題庫。\n\n先用「/新增 課本第一課」建題庫，再把單字傳給我。';
      }

      // 有指定題庫名稱就直接給那一份
      if (cmd.arg) {
        const chk = normalizeDeckName(cmd.arg);
        if (chk.error) return chk.error;
        const deck = usable.find((d) => d.name === chk.name);
        if (!deck) {
          const names = usable.map((d) => '・' + d.name).join('\n');
          return `找不到有單字的題庫「${chk.name}」。\n\n可以測驗的有：\n${names}`;
        }
        return quizText(env, user, deck);
      }

      // 沒指定就把每個題庫的測驗連結都列出來
      const lines = usable.map((d) =>
        `【${d.name}】${d.word_count} 字・${Math.min(5, d.word_count)} 題\n${quizUrl(env, user, d.id)}`
      ).join('\n\n');
      return `選一個開始測驗：\n\n${lines}\n\n（也可以直接說「/測驗 課本第一課」）`;
    }

    case 'play':
      return playText(env, user);

    default:
      return `不認得這個指令。\n\n${helpText()}`;
  }
}

export async function addWordsFromText(text, user, env) {
  const parsed = parseWordLines(text);
  if (!parsed.ok.length && !parsed.bad.length) return helpText();

  if (!parsed.ok.length) {
    return '這些我沒辦法當成單字收進去：\n' +
      parsed.bad.slice(0, 5).map((b) => `・${b.text}（${b.reason}）`).join('\n') +
      '\n\n格式是「英文 中文」，一行一個，例如：\napple 蘋果';
  }

  const deck = await ensureCurrentDeck(user, env);
  const res = await DB.addWords(env.DB, deck.id, parsed.ok, 'text');
  return summary(deck, parsed.ok, res, parsed.bad, env, user);
}

/* ========================= 圖片訊息 ========================= */

export async function handleImageMessage(messageId, user, env, replyToken) {
  const deck = await ensureCurrentDeck(user, env);

  // 預設走本地 OCR：排進佇列，等你的機器來領
  if ((env.OCR_MODE || 'local') === 'local') {
    const pending = await DB.countPendingJobs(env.DB);
    await DB.createJob(env.DB, {
      lineUserId: user.line_user_id,
      deckId: deck.id,
      source: 'line',
      messageId,
      replyToken
    });
    return { defer: true, text:
      `收到圖片，排進「${deck.name}」的辨識佇列了。` +
      (pending > 0 ? `\n前面還有 ${pending} 張。` : '') +
      '\n辨識完成會再通知你。' };
  }

  // OCR_MODE=cloud：直接用 Claude 辨識
  if (!env.ANTHROPIC_API_KEY) {
    return '圖片辨識還沒設定好。\n目前可以用打字的方式上傳：\n\napple 蘋果\nbanana 香蕉';
  }

  const image = await LINE.getImageContent(env.LINE_CHANNEL_ACCESS_TOKEN, messageId);
  const result = await extractFromImage(env.ANTHROPIC_API_KEY, image);

  if (!result.words.length) {
    return result.note
      ? `沒有讀到單字：${result.note}`
      : '這張圖片裡沒有讀到英文單字。試試看拍清楚一點，或直接打字傳給我。';
  }

  const res = await DB.addWords(env.DB, deck.id, result.words, 'image');
  return summary(deck, result.words, res, result.skipped, env, user, result.note);
}

/* ========================= 共用 ========================= */

export async function ensureCurrentDeck(user, env) {
  if (user.current_deck_id) {
    const deck = await DB.getDeck(env.DB, user.current_deck_id);
    if (deck) return deck;
  }
  const { deck } = await DB.createDeck(env.DB, user.line_user_id, '我的單字');
  await DB.setCurrentDeck(env.DB, user.line_user_id, deck.id);
  user.current_deck_id = deck.id;
  return deck;
}

function summary(deck, entries, res, bad, env, user, note) {
  const ipaMap = res.ipaMap || {};
  const preview = entries.slice(0, 8).map((e) => {
    const ipa = ipaMap[e.word] ? ' ' + ipaMap[e.word] : '';
    return `・${e.word}${ipa}${e.zh ? '　' + e.zh : ''}`;
  }).join('\n');

  const noIpa = entries.filter((e) => !ipaMap[e.word]).length;

  let out = `已收進「${deck.name}」：新增 ${res.added} 個`;
  if (res.dup) out += `，${res.dup} 個已存在`;
  out += '\n\n' + preview;
  if (entries.length > 8) out += `\n…等共 ${entries.length} 個`;
  if (noIpa) out += `\n\n（${noIpa} 個字辭典查不到音標，遊戲裡仍可用發音）`;
  if (bad && bad.length) out += `\n\n略過 ${bad.length} 筆無法辨識的內容`;
  if (note) out += `\n\n備註：${note}`;
  out += `\n\n開始測驗：${quizUrl(env, user, deck.id)}`;
  return out;
}

function gameUrl(env, user) {
  const base = env.GAME_URL || 'https://example.com';
  return `${base}?t=${user.web_token}`;
}

/** 單一題庫的測驗連結，打開就直接開始那一份 */
function quizUrl(env, user, deckId) {
  return `${gameUrl(env, user)}&d=${deckId}`;
}

function quizText(env, user, deck) {
  const rounds = Math.min(5, deck.word_count);
  return `【${deck.name}】的測驗\n${deck.word_count} 個單字，這一局考 ${rounds} 題\n\n${quizUrl(env, user, deck.id)}\n\n點連結在網頁上作答。`;
}

function playText(env, user) {
  return `你的專屬遊戲連結：\n${gameUrl(env, user)}\n\n這個連結綁定你的 LINE 帳號，會看到你所有的題庫。不要外流給別人。`;
}

function welcomeText(env, user) {
  return `歡迎使用單字吊人！\n\n把英文單字傳給我，或直接拍課本照片，我會幫你收進題庫並自動補上音標。\n\n${helpText()}`;
}

function helpText() {
  return `【怎麼加單字】
直接打字，一行一個：
apple 蘋果
ice cream 冰淇淋
banana

或直接傳課本、筆記的照片。

【指令】
/題庫　　　　　看所有題庫
/新增 課本第一課　建立題庫並切換
/切換 社團第一課　換題庫
/清單　　　　　看目前題庫的單字
/移除 apple　　刪掉一個單字
/刪除 課本第一課　刪掉整個題庫
/測驗　　　　　取得測驗連結
/測驗 課本第一課　直接考這一份
/玩　　　　　　所有題庫的總覽連結`;
}

/* ========================= 本地 OCR 佇列 API ========================= */

/**
 * 給本地端（RTX 5060）呼叫的介面。
 * 本地機器只發出連線、不接受連線，所以不必對外開放任何連接埠。
 * 以共用金鑰驗證，金鑰用 wrangler secret 設定。
 */
async function handleOcrApi(url, request, env) {
  const key = request.headers.get('x-ocr-key') || url.searchParams.get('k');
  if (!env.OCR_WORKER_KEY || key !== env.OCR_WORKER_KEY) {
    return json({ error: 'unauthorized' }, 401);
  }

  // 領一份工作
  if (url.pathname === '/ocr/claim' && request.method === 'POST') {
    const job = await DB.claimJob(env.DB);
    if (!job) return json({ job: null });
    const deck = await DB.getDeck(env.DB, job.deck_id);
    return json({
      job: {
        id: job.id,
        deckName: deck ? deck.name : '',
        imageUrl: `${url.origin}/ocr/image/${job.id}`
      }
    });
  }

  // 取圖：由 Worker 代為向 LINE 下載，本地端不需要 LINE 的權杖
  if (url.pathname.startsWith('/ocr/image/') && request.method === 'GET') {
    const id = parseInt(url.pathname.split('/').pop(), 10);
    const job = await DB.getJob(env.DB, id);
    if (!job || !job.line_message_id) return json({ error: 'not found' }, 404);

    const res = await fetch(
      `https://api-data.line.me/v2/bot/message/${job.line_message_id}/content`,
      { headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` } }
    );
    if (!res.ok) return json({ error: 'image fetch failed' }, 502);
    return new Response(res.body, {
      headers: { 'Content-Type': res.headers.get('content-type') || 'image/jpeg' }
    });
  }

  // 回報辨識結果
  if (url.pathname === '/ocr/result' && request.method === 'POST') {
    const body = await request.json();
    const job = await DB.getJob(env.DB, body.jobId);
    if (!job) return json({ error: 'unknown job' }, 404);

    if (body.error) {
      await DB.finishJob(env.DB, job.id, 0, String(body.error).slice(0, 300));
      await notify(env, job, `圖片辨識失敗：${body.error}\n可以改用打字上傳，或換一張清楚一點的照片。`);
      return json({ ok: true });
    }

    const { words, skipped } = cleanResult({ words: body.words || [], note: '' });
    const deck = await DB.getDeck(env.DB, job.deck_id);
    if (!deck) {
      await DB.finishJob(env.DB, job.id, 0, 'deck missing');
      return json({ ok: true });
    }

    if (!words.length) {
      await DB.finishJob(env.DB, job.id, 0, null);
      await notify(env, job, '這張圖片沒有讀到英文單字。試試看拍清楚一點，或直接打字傳給我。');
      return json({ ok: true, added: 0 });
    }

    const user = await db_userOf(env, job.line_user_id);
    const res = await DB.addWords(env.DB, deck.id, words, 'image');
    await DB.finishJob(env.DB, job.id, res.added, null);
    await notify(env, job, summary(deck, words, res, skipped, env, user));
    return json({ ok: true, added: res.added });
  }

  if (url.pathname === '/ocr/status') {
    return json({ pending: await DB.countPendingJobs(env.DB) });
  }

  return json({ error: 'not found' }, 404);
}

async function db_userOf(env, lineUserId) {
  return DB.ensureUser(env.DB, lineUserId, '');
}

/** 辨識完成的通知：先用 replyToken（免費），失效就改用 push */
async function notify(env, job, text) {
  if (job.reply_token) {
    const ok = await LINE.reply(env.LINE_CHANNEL_ACCESS_TOKEN, job.reply_token, text);
    if (ok) return;
  }
  await LINE.push(env.LINE_CHANNEL_ACCESS_TOKEN, job.line_user_id, text);
}

/* ========================= 網頁 API ========================= */

async function handleLiff(request, env) {
  const { idToken } = await request.json();
  if (!idToken) return json({ error: 'missing idToken' }, 400);

  // 向 LINE 驗證 idToken，確認是本人且是這個 channel 發出的
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: env.LIFF_CHANNEL_ID })
  });
  if (!res.ok) return json({ error: 'invalid idToken' }, 401);

  const claims = await res.json();
  const user = await DB.ensureUser(env.DB, claims.sub, claims.name || '');
  const decks = await DB.listDecks(env.DB, user.line_user_id);
  return json({ token: user.web_token, name: user.display_name, decks });
}

async function handleDecks(url, env) {
  const token = url.searchParams.get('t');
  if (!token) return json({ error: 'missing token' }, 400);
  const user = await DB.getUserByToken(env.DB, token);
  if (!user) return json({ error: 'unknown token' }, 401);
  const decks = await DB.listDecks(env.DB, user.line_user_id);
  return json({ name: user.display_name, decks });
}

async function handleDeckWords(url, env) {
  const token = url.searchParams.get('t');
  const deckId = parseInt(url.pathname.split('/').pop(), 10);
  if (!token || !deckId) return json({ error: 'missing token or deck id' }, 400);

  const user = await DB.getUserByToken(env.DB, token);
  if (!user) return json({ error: 'unknown token' }, 401);

  const deck = await DB.getDeck(env.DB, deckId);
  if (!deck || deck.line_user_id !== user.line_user_id) return json({ error: 'not found' }, 404);

  const words = await DB.listWords(env.DB, deckId);
  return json({ id: deck.id, name: deck.name, words });
}
