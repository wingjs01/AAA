import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { verifySignature } from '../src/line.js';
import { cleanResult } from '../src/extract.js';

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.log('  ✗', name, '\n      ', e.message); }
};

const SECRET = 'test_channel_secret_abc123';
const sign = (body) => createHmac('sha256', SECRET).update(body).digest('base64');

console.log('\n[LINE 簽章驗證]');
const body = JSON.stringify({ events: [{ type: 'message', message: { text: 'apple 蘋果' } }] });

await t('正確簽章通過', async () =>
  assert.equal(await verifySignature(SECRET, body, sign(body)), true));

await t('竄改內容被擋下', async () =>
  assert.equal(await verifySignature(SECRET, body + ' ', sign(body)), false));

await t('錯誤金鑰被擋下', async () => {
  const bad = createHmac('sha256', 'wrong_secret').update(body).digest('base64');
  assert.equal(await verifySignature(SECRET, body, bad), false);
});

await t('缺少簽章被擋下', async () =>
  assert.equal(await verifySignature(SECRET, body, null), false));

await t('空字串簽章被擋下', async () =>
  assert.equal(await verifySignature(SECRET, body, ''), false));

await t('長度不同的簽章被擋下', async () =>
  assert.equal(await verifySignature(SECRET, body, 'abc'), false));

await t('含中文的內容也能正確驗證', async () => {
  const zh = JSON.stringify({ text: '課本第一課：蝴蝶 butterfly' });
  assert.equal(await verifySignature(SECRET, zh, sign(zh)), true);
});

console.log('\n[辨識結果清洗]');
await t('正常結果保留', () => {
  const r = cleanResult({ words: [{ word: 'Butterfly', zh: '蝴蝶' }, { word: 'ice cream', zh: '冰淇淋' }], note: '' });
  assert.deepEqual(r.words, [{ word: 'butterfly', zh: '蝴蝶' }, { word: 'ice cream', zh: '冰淇淋' }]);
});
await t('濾掉詞性標記與編號等雜訊', () => {
  const r = cleanResult({ words: [
    { word: '1.', zh: '' }, { word: 'n.', zh: '' }, { word: 'apple', zh: '蘋果' }, { word: 'Lesson 3', zh: '' }
  ], note: '' });
  assert.equal(r.words.length, 1);
  assert.equal(r.words[0].word, 'apple');
  assert.equal(r.skipped.length, 3);
});
await t('同一張圖裡的重複只留一筆', () => {
  const r = cleanResult({ words: [{ word: 'apple', zh: '蘋果' }, { word: 'APPLE', zh: '蘋果' }], note: '' });
  assert.equal(r.words.length, 1);
});
await t('缺少中文時留空字串', () => {
  const r = cleanResult({ words: [{ word: 'apple' }], note: '' });
  assert.equal(r.words[0].zh, '');
});
await t('格式完全錯誤不會爆掉', () => {
  assert.deepEqual(cleanResult(null).words, []);
  assert.deepEqual(cleanResult({}).words, []);
  assert.deepEqual(cleanResult({ words: 'nope' }).words, []);
  assert.deepEqual(cleanResult({ words: [null, 5, {}] }).words, []);
});
await t('備註被帶出來', () => {
  assert.equal(cleanResult({ words: [], note: '圖片太模糊' }).note, '圖片太模糊');
});

console.log(`\n總計：${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
