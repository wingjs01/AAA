/** 客戶端整合測試：對真正跑起來的 Worker 呼叫（workerd 本機執行） */
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { HangmanClient, HangmanError, isVocabEvent } from '../../client/hangman-client.js';

const PORT = 8931, MOCK = 8930;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, x !== undefined ? '\n      ' + JSON.stringify(x) : ''); } };

console.log('\n[事件判斷（不需連線）]');
const msg = (text) => ({ type: 'message', message: { type: 'text', text }, source: { userId: 'U1' } });
t('單字清單 → 轉發', isVocabEvent(msg('apple 蘋果')));
t('多行單字 → 轉發', isVocabEvent(msg('apple 蘋果\nbanana 香蕉')));
t('指令 → 轉發', isVocabEvent(msg('/測驗')));
t('全形斜線 → 轉發', isVocabEvent(msg('／題庫')));
t('圖片 → 轉發', isVocabEvent({ type: 'message', message: { type: 'image', id: 'i1' } }));
t('純中文 → 不轉發', !isVocabEvent(msg('今天天氣不錯')));
t('別的 bot 指令 → 不轉發', !isVocabEvent(msg('/status')));
t('中英混雜句 → 不轉發', !isVocabEvent(msg('幫我查 apple 的意思')));
t('follow 事件 → 不轉發', !isVocabEvent({ type: 'follow' }));
t('空訊息 → 不轉發', !isVocabEvent(msg('   ')));

const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    if (req.url.includes('/profile/')) { res.writeHead(200, {'Content-Type':'application/json'}); return res.end('{"displayName":"客戶端測試"}'); }
    if (req.url.includes('/content')) { res.writeHead(200, {'Content-Type':'image/jpeg'}); return res.end(Buffer.from([0xff,0xd8,0xff,0xe0,9,9])); }
    res.writeHead(200, {'Content-Type':'application/json'}); res.end('{}');
  });
});
await new Promise((r) => mock.listen(MOCK, r));

const worker = spawn('npx', ['wrangler','dev','--local','--port',String(PORT),'--ip','127.0.0.1'], {
  cwd: process.cwd(),
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1',
         LINE_API_BASE: `http://127.0.0.1:${MOCK}/v2/bot`, LINE_DATA_API_BASE: `http://127.0.0.1:${MOCK}/v2/bot` },
  stdio: ['ignore','pipe','pipe']
});
let log = ''; worker.stdout.on('data', d => log += d); worker.stderr.on('data', d => log += d);
const cleanup = () => { try { worker.kill('SIGTERM'); } catch {} mock.close(); };
process.on('exit', cleanup);

let up = false;
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 500));
  try { if ((await fetch(`${BASE}/health`)).ok) { up = true; break; } } catch {}
}
if (!up) { console.error('Worker 沒起來\n' + log.slice(-1500)); cleanup(); process.exit(1); }

const hm = new HangmanClient({ baseUrl: BASE, forwardKey: 'local_forward_key', ocrKey: 'local_ocr_key' });
const UID = 'U_client_' + Date.now();
const ev = (text) => ({ type: 'message', replyToken: 'RT' + Math.random(), source: { type: 'user', userId: UID }, message: { type: 'text', id: 'M' + Math.random(), text } });

console.log('\n[基本呼叫]');
t('health', (await hm.health()).ok === true);

console.log('\n[轉發]');
const f1 = await hm.forwardEvent(ev('/新增 客戶端測試題庫'));
t('單一事件', f1.ok && f1.accepted === 1, f1);
await new Promise(r => setTimeout(r, 400));

const f2 = await hm.forwardEvents([ev('butterfly 蝴蝶'), ev('grape 葡萄')]);
t('多個事件', f2.accepted === 2, f2);
await new Promise(r => setTimeout(r, 600));

console.log('\n[route：自動分流]');
const mixed = [ev('mountain 山'), { type: 'message', replyToken: 'x', source: { userId: UID }, message: { type: 'text', text: '今天天氣不錯' } }];
const routed = await hm.route(mixed);
t('單字轉發、其他留下', routed.forwarded.length === 1 && routed.rest.length === 1, { f: routed.forwarded.length, r: routed.rest.length });
t('回報已接受數量', routed.accepted === 1, routed);
await new Promise(r => setTimeout(r, 400));

console.log('\n[題庫讀取]');
const quiz = await hm.forwardEvent(ev('/測驗'));
await new Promise(r => setTimeout(r, 400));
// 從 DB 拿 token：直接用 /api/decks 需要 token，改由 OCR 狀態驗證授權錯誤
let token = null;
{
  // 透過 liff 以外的方式取得 token：用錯誤 token 應被擋
  try { await hm.listDecks('deadbeef'); t('錯誤 token 被擋', false); }
  catch (e) { t('錯誤 token 被擋（401）', e instanceof HangmanError && e.status === 401, e.status); }
}

console.log('\n[OCR 佇列]');
const st = await hm.queueStatus();
t('讀得到佇列狀態', typeof st.pending === 'number', st);
t('沒有待處理工作時回 null', (await hm.claimJob()) === null);

console.log('\n[錯誤處理]');
{
  const noKey = new HangmanClient({ baseUrl: BASE });
  let threw = false;
  try { await noKey.forwardEvent(ev('apple')); } catch (e) { threw = /forwardKey/.test(e.message); }
  t('少了金鑰會明確報錯', threw);
}
{
  const badKey = new HangmanClient({ baseUrl: BASE, forwardKey: 'wrong' });
  let err = null;
  try { await badKey.forwardEvent(ev('apple')); } catch (e) { err = e; }
  t('金鑰錯誤丟出 401', err instanceof HangmanError && err.status === 401, err && err.status);
}
{
  const dead = new HangmanClient({ baseUrl: 'http://127.0.0.1:1', forwardKey: 'k', timeout: 1500 });
  let err = null;
  try { await dead.health(); } catch (e) { err = e; }
  t('連不到時丟出 HangmanError', err instanceof HangmanError && err.status === 0, err && err.message);
}

console.log('\n[遊戲連結]');
t('總覽連結', hm.gameUrl('https://g.example.com/', 'abc') === 'https://g.example.com?t=abc');
t('測驗連結', hm.gameUrl('https://g.example.com', 'abc', 7) === 'https://g.example.com?t=abc&d=7');

console.log(`\n總計：${pass} 通過，${fail} 失敗`);
cleanup();
process.exit(fail ? 1 : 0);
