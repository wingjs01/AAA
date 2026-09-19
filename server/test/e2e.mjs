/**
 * 端對端測試：用 workerd 真的把 Worker 跑起來，
 * 只有 LINE 那一端換成測試替身（開發環境連不到 api.line.me）。
 *
 * 涵蓋：簽章驗證、路由、D1 讀寫、指令、音標補齊、
 *       圖片佇列、本地 OCR 回報、網頁 API 的權限隔離。
 */
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';

const SECRET = 'local_test_secret';
// 本機 D1 的資料會留到下次，所以每次跑都用新的使用者，測試才能重複執行
const UID = 'U_e2e_' + Date.now();
const OCR_KEY = 'local_ocr_key';
const MOCK_PORT = 8920;
const WORKER_PORT = 8921;
const BASE = `http://127.0.0.1:${WORKER_PORT}`;

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra !== undefined ? '\n      ' + JSON.stringify(extra) : ''); }
};

/* ---------- 假的 LINE 伺服器 ---------- */
const sent = { reply: [], push: [] };
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url.endsWith('/message/reply')) {
      sent.reply.push(JSON.parse(body || '{}'));
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{}');
    }
    if (req.url.endsWith('/message/push')) {
      sent.push.push(JSON.parse(body || '{}'));
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{}');
    }
    if (req.url.includes('/profile/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ displayName: '測試使用者', userId: UID }));
    }
    if (req.url.includes('/content')) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
    }
    res.writeHead(404); res.end('{}');
  });
});

const lastReply = () => (sent.reply.at(-1)?.messages?.[0]?.text) || '';
const lastPush = () => (sent.push.at(-1)?.messages?.[0]?.text) || '';

/* ---------- 送出模擬的 LINE 事件 ---------- */
async function webhook(events, { badSig = false } = {}) {
  const body = JSON.stringify({ destination: 'Uxxx', events });
  const sig = createHmac('sha256', badSig ? 'wrong' : SECRET).update(body).digest('base64');
  const res = await fetch(`${BASE}/line/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sig },
    body
  });
  await new Promise((r) => setTimeout(r, 450));   // 等背景處理完成
  return res;
}

const textEvent = (text, i = 0) => ({
  type: 'message', replyToken: 'RT' + Date.now() + i,
  source: { type: 'user', userId: UID },
  message: { type: 'text', id: 'M' + Date.now() + i, text }
});

const imageEvent = () => ({
  type: 'message', replyToken: 'RT_img' + Date.now(),
  source: { type: 'user', userId: UID },
  message: { type: 'image', id: 'IMG_1' }
});

/* ---------- 主流程 ---------- */
await new Promise((r) => mock.listen(MOCK_PORT, r));

const worker = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(WORKER_PORT), '--ip', '127.0.0.1'], {
  cwd: process.cwd(),
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let workerLog = '';
worker.stdout.on('data', (d) => { workerLog += d; });
worker.stderr.on('data', (d) => { workerLog += d; });

const cleanup = () => { try { worker.kill('SIGTERM'); } catch {} mock.close(); };
process.on('exit', cleanup);

// 等 Worker 起來
let up = false;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const r = await fetch(`${BASE}/health`);
    if (r.ok) { up = true; break; }
  } catch {}
}
if (!up) {
  console.error('Worker 沒有起來：\n' + workerLog.slice(-2000));
  cleanup(); process.exit(1);
}
console.log('Worker 已啟動（workerd 本機執行）\n');

console.log('[簽章驗證]');
const badRes = await webhook([textEvent('apple 蘋果')], { badSig: true });
t('錯誤簽章被擋下（401）', badRes.status === 401, badRes.status);
t('被擋下時完全沒有回覆', sent.reply.length === 0 && sent.push.length === 0);

console.log('\n[加好友]');
await webhook([{ type: 'follow', replyToken: 'RT_follow', source: { type: 'user', userId: UID } }]);
t('回覆歡迎訊息', lastReply().includes('歡迎使用單字吊人'));
t('附上使用說明', lastReply().includes('/題庫'));

console.log('\n[題庫指令]');
await webhook([textEvent('/題庫')]);
t('一開始沒有題庫', lastReply().includes('還沒有任何題庫'));

await webhook([textEvent('/新增 課本第一課')]);
t('建立題庫', lastReply().includes('已建立題庫「課本第一課」'));

console.log('\n[文字上傳單字]');
await webhook([textEvent('butterfly 蝴蝶\nice cream 冰淇淋\nknowledge')]);
const r1 = lastReply();
t('收進正確的題庫', r1.includes('已收進「課本第一課」'));
t('新增 3 個', r1.includes('新增 3 個'));
t('自動補上音標', r1.includes('/ˈbʌt.ər.flaɪ/'), r1);
t('片語音標逐字組合', r1.includes('/aɪs kriːm/'), r1);
t('附上測驗連結', /開始測驗：.*&d=\d+/.test(r1), r1);

await webhook([textEvent('butterfly 蝴蝶')]);
t('重複的字不重覆寫入', lastReply().includes('新增 0 個') && lastReply().includes('1 個已存在'));

console.log('\n[要求測驗]');
await webhook([textEvent('/測驗')]);
const quiz = lastReply();
t('列出題庫與連結', quiz.includes('【課本第一課】'));
const quizLink = quiz.match(/(https?:\/\/\S+?\?t=[a-f0-9]+&d=\d+)/);
t('連結同時帶帳號與題庫', !!quizLink, quiz);

await webhook([textEvent('/測驗 課本第一課')]);
t('指定題庫直接給連結', lastReply().includes('【課本第一課】的測驗'));

console.log('\n[圖片 → 本地 OCR 佇列]');
sent.push.length = 0;
await webhook([imageEvent()]);
t('圖片排進佇列並通知', lastPush().includes('排進「課本第一課」的辨識佇列'), lastPush());

const status = await (await fetch(`${BASE}/ocr/status`, { headers: { 'x-ocr-key': OCR_KEY } })).json();
t('佇列有待處理的工作', status.pending >= 1, status);

console.log('\n[本地 OCR 端取件與回報]');
const noAuth = await fetch(`${BASE}/ocr/claim`, { method: 'POST' });
t('沒有金鑰領不到工作（401）', noAuth.status === 401);

const claimRes = await fetch(`${BASE}/ocr/claim`, { method: 'POST', headers: { 'x-ocr-key': OCR_KEY } });
const { job } = await claimRes.json();
t('領到工作', !!job && job.deckName === '課本第一課', job);

const imgRes = await fetch(job.imageUrl, { headers: { 'x-ocr-key': OCR_KEY } });
const imgBuf = Buffer.from(await imgRes.arrayBuffer());
t('可透過 Worker 取得圖片', imgRes.ok && imgBuf[0] === 0xff && imgBuf[1] === 0xd8, imgBuf.length);

const claim2 = await (await fetch(`${BASE}/ocr/claim`, { method: 'POST', headers: { 'x-ocr-key': OCR_KEY } })).json();
t('同一份不會被重複領走', claim2.job === null, claim2);

sent.reply.length = 0; sent.push.length = 0;
await fetch(`${BASE}/ocr/result`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-ocr-key': OCR_KEY },
  body: JSON.stringify({
    jobId: job.id,
    words: [{ word: 'mountain', zh: '' }, { word: 'hospital', zh: '醫院' }],
    fixes: [{ from: 'rnountain', to: 'mountain' }],
    suspect: ['zzzqqq']
  })
});
await new Promise((r) => setTimeout(r, 300));
const ocrMsg = lastReply() || lastPush();
t('辨識結果寫入題庫並通知', ocrMsg.includes('新增 2 個'), ocrMsg);
t('無中文的字也收錄', ocrMsg.includes('mountain'), ocrMsg);
t('補上音標', ocrMsg.includes('/ˈmaʊn.tən/'), ocrMsg);
t('回報拼字修正', ocrMsg.includes('rnountain → mountain'), ocrMsg);
t('提醒可疑的字', ocrMsg.includes('zzzqqq'), ocrMsg);

const status2 = await (await fetch(`${BASE}/ocr/status`, { headers: { 'x-ocr-key': OCR_KEY } })).json();
t('處理完後佇列減少', status2.pending < status.pending, { before: status.pending, after: status2.pending });

console.log('\n[網頁 API]');
const token = quizLink[0].match(/t=([a-f0-9]+)/)[1];
const decksRes = await fetch(`${BASE}/api/decks?t=${token}`);
const decks = await decksRes.json();
t('用 token 取得題庫清單', decks.decks?.[0]?.name === '課本第一課', decks);
t('單字數正確（3 + 2）', decks.decks[0].word_count === 5, decks.decks[0]);

const deckId = decks.decks[0].id;
const wordsRes = await fetch(`${BASE}/api/deck/${deckId}?t=${token}`);
const wordsData = await wordsRes.json();
t('取得單字內容', wordsData.words.some((w) => w.word === 'butterfly' && w.ipa), wordsData.words?.[0]);

const badToken = await fetch(`${BASE}/api/decks?t=deadbeef`);
t('錯誤 token 被擋（401）', badToken.status === 401);

const otherDeck = await fetch(`${BASE}/api/deck/99999?t=${token}`);
t('取不到不存在的題庫（404）', otherDeck.status === 404);

console.log(`\n總計：${pass} 通過，${fail} 失敗`);
cleanup();
process.exit(fail ? 1 : 0);
