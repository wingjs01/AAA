/**
 * 部署後檢查：確認 Worker 正常、簽章驗證有效、OCR 金鑰可用。
 *
 *   WORKER_URL=https://xxx.workers.dev \
 *   LINE_CHANNEL_SECRET=你的secret \
 *   OCR_WORKER_KEY=你的金鑰 \
 *   node tools/check-deploy.mjs
 */
import { createHmac } from 'node:crypto';

const URL_BASE = (process.env.WORKER_URL || '').replace(/\/$/, '');
const SECRET = process.env.LINE_CHANNEL_SECRET || '';
const OCR_KEY = process.env.OCR_WORKER_KEY || '';

if (!URL_BASE) {
  console.error('請設定 WORKER_URL');
  process.exit(1);
}

let ok = 0, bad = 0;
const check = (name, cond, detail) => {
  if (cond) { ok++; console.log('  ✓', name); }
  else { bad++; console.log('  ✗', name, detail ? '\n      ' + detail : ''); }
};

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('逾時')), ms));
const get = (path, headers) => Promise.race([fetch(URL_BASE + path, { headers }), timeout(15000)]);

console.log('檢查 ' + URL_BASE + '\n');

console.log('[基本連線]');
try {
  const res = await get('/health');
  const body = await res.json();
  check('Worker 有回應', res.ok && body.ok === true, `HTTP ${res.status}`);
} catch (e) {
  check('Worker 有回應', false, e.message + '（網址打錯？還沒部署？）');
}

console.log('\n[LINE Webhook]');
const body = JSON.stringify({ destination: 'U0', events: [] });

try {
  const res = await Promise.race([fetch(URL_BASE + '/line/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': 'obviously-wrong' },
    body
  }), timeout(15000)]);
  check('錯誤簽章被擋下', res.status === 401,
        `收到 HTTP ${res.status}，預期 401。若是 500，通常是 LINE_CHANNEL_SECRET 沒設定`);
} catch (e) {
  check('錯誤簽章被擋下', false, e.message);
}

if (SECRET) {
  try {
    const sig = createHmac('sha256', SECRET).update(body).digest('base64');
    const res = await Promise.race([fetch(URL_BASE + '/line/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-line-signature': sig },
      body
    }), timeout(15000)]);
    check('正確簽章被接受', res.ok,
          `收到 HTTP ${res.status}。若是 401，表示 Worker 上的 LINE_CHANNEL_SECRET 跟你這裡給的不一樣`);
  } catch (e) {
    check('正確簽章被接受', false, e.message);
  }
} else {
  console.log('  － 略過簽章正確性檢查（未提供 LINE_CHANNEL_SECRET）');
}

console.log('\n[本地 OCR 介面]');
try {
  const res = await get('/ocr/status', { 'x-ocr-key': 'wrong-key' });
  check('錯誤金鑰被擋下', res.status === 401, `收到 HTTP ${res.status}`);
} catch (e) {
  check('錯誤金鑰被擋下', false, e.message);
}

if (OCR_KEY) {
  try {
    const res = await get('/ocr/status', { 'x-ocr-key': OCR_KEY });
    const data = await res.json();
    check('正確金鑰可讀取佇列', res.ok && typeof data.pending === 'number',
          `HTTP ${res.status}。若是 401，表示 Worker 上的 OCR_WORKER_KEY 跟你這裡給的不一樣`);
    if (res.ok) console.log(`      目前待辨識：${data.pending} 張`);
  } catch (e) {
    check('正確金鑰可讀取佇列', false, e.message);
  }
} else {
  console.log('  － 略過金鑰檢查（未提供 OCR_WORKER_KEY）');
}

console.log(`\n${bad ? '有 ' + bad + ' 項沒通過' : '全部通過'}（${ok} 項正常）`);
if (!bad) {
  console.log('\n接下來：');
  console.log('  1. 到 LINE Developers 把 Webhook URL 設成 ' + URL_BASE + '/line/webhook 並按 Verify');
  console.log('  2. 用手機加機器人好友，傳一句「apple 蘋果」');
  console.log('  3. 機器人應該回覆「已收進…」並附上音標與測驗連結');
}
process.exit(bad ? 1 : 0);
