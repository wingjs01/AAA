import assert from 'node:assert';
import { makeD1 } from './d1-shim.mjs';
import * as DB from '../src/db.js';

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.log('  ✗', name, '\n      ', e.message); }
};

const db = makeD1('./schema.sql');
const UID = 'U_queue';
await DB.ensureUser(db, UID, '測試');
const { deck } = await DB.createDeck(db, UID, '課本第一課');

console.log('\n[佇列基本流程]');
let jobId;
await t('建立工作', async () => {
  jobId = await DB.createJob(db, { lineUserId: UID, deckId: deck.id, source: 'line', messageId: 'M1', replyToken: 'R1' });
  assert.ok(jobId > 0);
  assert.equal(await DB.countPendingJobs(db), 1);
});

await t('領取工作會標記為 working', async () => {
  const job = await DB.claimJob(db);
  assert.equal(job.id, jobId);
  assert.equal(job.status, 'working');
  assert.equal(job.line_message_id, 'M1');
  assert.equal(job.reply_token, 'R1');
});

await t('沒有待處理時領不到東西', async () => {
  assert.equal(await DB.claimJob(db), null);
});

await t('完成後不再計入待處理', async () => {
  await DB.finishJob(db, jobId, 8, null);
  const job = await DB.getJob(db, jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result_count, 8);
  assert.equal(await DB.countPendingJobs(db), 0);
});

await t('失敗會記錄原因', async () => {
  const id = await DB.createJob(db, { lineUserId: UID, deckId: deck.id, messageId: 'M2' });
  await DB.claimJob(db);
  await DB.finishJob(db, id, 0, '圖片太模糊');
  const job = await DB.getJob(db, id);
  assert.equal(job.status, 'failed');
  assert.equal(job.error, '圖片太模糊');
});

console.log('\n[不會重複領取]');
await t('同一份工作只會被領走一次', async () => {
  await DB.createJob(db, { lineUserId: UID, deckId: deck.id, messageId: 'M3' });
  const a = await DB.claimJob(db);
  const b = await DB.claimJob(db);
  assert.ok(a, '第一次要領到');
  assert.equal(b, null, '第二次不該再領到同一份');
});

await t('多份工作依序領取', async () => {
  const ids = [];
  for (const m of ['M4', 'M5', 'M6']) ids.push(await DB.createJob(db, { lineUserId: UID, deckId: deck.id, messageId: m }));
  const got = [];
  for (let i = 0; i < 3; i++) got.push((await DB.claimJob(db)).id);
  assert.deepEqual(got, ids, '應依建立順序領取');
});

console.log('\n[卡住的工作會被放回]');
await t('超過三分鐘沒完成會重新排隊', async () => {
  const fresh = makeD1('./schema.sql');
  await DB.ensureUser(fresh, UID, '測試');
  const d2 = (await DB.createDeck(fresh, UID, 'x')).deck;
  const id = await DB.createJob(fresh, { lineUserId: UID, deckId: d2.id, messageId: 'M7' });
  await DB.claimJob(fresh);
  assert.equal(await DB.claimJob(fresh), null, '還在處理中不該被重領');

  // 把 claimed_at 往回調，模擬機器掛掉
  fresh._raw.prepare('UPDATE jobs SET claimed_at = ? WHERE id = ?')
    .run(Date.now() - 5 * 60 * 1000, id);
  const again = await DB.claimJob(fresh);
  assert.ok(again, '過期後應該可以重領');
  assert.equal(again.id, id);
});

await t('重試超過三次就不再放回', async () => {
  const fresh = makeD1('./schema.sql');
  await DB.ensureUser(fresh, UID, '測試');
  const d3 = (await DB.createDeck(fresh, UID, 'y')).deck;
  const id = await DB.createJob(fresh, { lineUserId: UID, deckId: d3.id, messageId: 'M8' });
  for (let i = 0; i < 3; i++) {
    await DB.claimJob(fresh);
    fresh._raw.prepare('UPDATE jobs SET claimed_at = ? WHERE id = ?').run(Date.now() - 5 * 60 * 1000, id);
  }
  assert.equal(await DB.claimJob(fresh), null, '第四次不該再領到');
});

console.log(`\n總計：${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
