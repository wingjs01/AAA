import assert from 'node:assert';
import { makeD1, seedDict } from './d1-shim.mjs';
import * as DB from '../src/db.js';
import { handleTextMessage } from '../src/index.js';

// Worker 環境有全域 crypto，Node 也有，這裡確認一下
assert.ok(globalThis.crypto && globalThis.crypto.getRandomValues, '需要 crypto');

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.log('  ✗', name, '\n      ', e.message); }
};

const db = makeD1('./schema.sql');
seedDict(db, [
  ['apple', 'ˈæp.əl'], ['banana', 'bəˈnæn.ə'], ['ice', 'aɪs'], ['cream', 'kriːm'],
  ['butterfly', 'ˈbʌt.ər.flaɪ'], ['cherry', 'ˈtʃer.i']
]);

const env = { DB: db, GAME_URL: 'https://game.example.com' };
const UID = 'U_test_user';

const reload = async () => DB.ensureUser(db, UID, '測試使用者');
const say = async (text) => handleTextMessage(text, await reload(), env);

console.log('\n[使用者初始化]');
await t('第一次訊息自動建立使用者', async () => {
  const u = await reload();
  assert.equal(u.line_user_id, UID);
  assert.ok(u.web_token && u.web_token.length === 32, 'web_token 應為 32 字元');
});
await t('重複呼叫不會重建', async () => {
  const a = await reload(), b = await reload();
  assert.equal(a.web_token, b.web_token);
});

console.log('\n[題庫管理]');
await t('一開始沒有題庫', async () => assert.match(await say('/題庫'), /還沒有任何題庫/));
await t('建立題庫', async () => assert.match(await say('/新增 課本第一課'), /已建立題庫「課本第一課」/));
await t('重複建立會提示已存在', async () => assert.match(await say('/新增 課本第一課'), /已經存在/));
await t('建立第二個題庫', async () => assert.match(await say('/新增 社團第一課'), /已建立/));
await t('清單顯示兩個題庫', async () => {
  const out = await say('/題庫');
  assert.match(out, /課本第一課/);
  assert.match(out, /社團第一課/);
  assert.match(out, /▶ 社團第一課/, '最後建立的應為目前題庫');
});
await t('切換題庫', async () => {
  assert.match(await say('/切換 課本第一課'), /已切換到「課本第一課」/);
  assert.match(await say('/題庫'), /▶ 課本第一課/);
});
await t('切換不存在的題庫', async () => assert.match(await say('/切換 不存在'), /找不到題庫/));

console.log('\n[加單字：文字]');
await t('多行加入並自動補音標', async () => {
  const out = await say('apple 蘋果\nbanana 香蕉\nice cream 冰淇淋');
  assert.match(out, /新增 3 個/);
  assert.match(out, /ˈæp\.əl/, '應顯示自動查到的音標');
  assert.match(out, /aɪs kriːm/, '片語音標應逐字組合');
});
await t('重複單字不重覆寫入', async () => {
  const out = await say('apple 蘋果');
  assert.match(out, /新增 0 個/);
  assert.match(out, /1 個已存在/);
});
await t('辭典查無的字仍可收錄', async () => {
  const out = await say('zzzqqq 測試字');
  assert.match(out, /新增 1 個/);
  assert.match(out, /辭典查不到音標/);
});
await t('無效輸入給出說明', async () => {
  const out = await say('12345');
  assert.match(out, /沒辦法當成單字/);
});
await t('單字進到正確的題庫', async () => {
  const out = await say('/清單');
  // apple、banana、ice cream、zzzqqq —— 重複送的 apple 不會再增加
  assert.match(out, /「課本第一課」共 4 個單字/);
  assert.match(out, /ice cream/);
});
await t('另一個題庫是空的', async () => {
  await say('/切換 社團第一課');
  assert.match(await say('/清單'), /目前是空的/);
});
await t('同樣的字可以存在不同題庫', async () => {
  const out = await say('apple 蘋果');
  assert.match(out, /新增 1 個/);
});

console.log('\n[移除]');
await t('移除單字', async () => assert.match(await say('/移除 apple'), /已從目前題庫移除/));
await t('移除不存在的單字', async () => assert.match(await say('/移除 apple'), /沒有「apple」/));
await t('刪除整個題庫', async () => {
  await say('/切換 課本第一課');
  assert.match(await say('/刪除 社團第一課'), /已刪除題庫「社團第一課」/);
  const out = await say('/題庫');
  assert.doesNotMatch(out, /社團第一課/);
});

console.log('\n[沒有題庫時自動建立]');
await t('新使用者直接傳單字會自動開題庫', async () => {
  const u2 = await DB.ensureUser(db, 'U_second', '第二人');
  const out = await handleTextMessage('cherry 櫻桃', u2, env);
  assert.match(out, /已收進「我的單字」/);
  assert.match(out, /ˈtʃer\.i/);
});
await t('兩個使用者的題庫互不干擾', async () => {
  const mine = await DB.listDecks(db, UID);
  const other = await DB.listDecks(db, 'U_second');
  assert.equal(mine.length, 1);
  assert.equal(other.length, 1);
  assert.equal(other[0].name, '我的單字');
});

console.log('\n[要求測驗]');
await t('沒有題庫時提示先建立', async () => {
  const u3 = await DB.ensureUser(db, 'U_quiz_empty', '空的人');
  assert.match(await handleTextMessage('/測驗', u3, env), /還沒有可以測驗的題庫/);
});
await t('列出所有可測驗的題庫與連結', async () => {
  const out = await say('/測驗');
  assert.match(out, /【課本第一課】/);
  assert.match(out, /&d=\d+/, '連結要帶題庫編號');
});
await t('指定題庫直接給該份連結', async () => {
  const u = await reload();
  const decks = await DB.listDecks(db, UID);
  const target = decks.find((d) => d.name === '課本第一課');
  const out = await say('/測驗 課本第一課');
  assert.match(out, new RegExp('\\?t=' + u.web_token + '&d=' + target.id));
  assert.match(out, /這一局考 4 題/);
});
await t('指定不存在的題庫會列出可用的', async () => {
  const out = await say('/測驗 沒這個');
  assert.match(out, /找不到有單字的題庫/);
  assert.match(out, /・課本第一課/);
});
await t('空題庫不會出現在測驗清單', async () => {
  await say('/新增 全空的題庫');
  const out = await say('/測驗');
  assert.doesNotMatch(out, /全空的題庫/);
  await say('/切換 課本第一課');
});
await t('收完單字直接附上該題庫的測驗連結', async () => {
  const decks = await DB.listDecks(db, UID);
  const target = decks.find((d) => d.name === '課本第一課');
  const out = await say('grape 葡萄');
  assert.match(out, new RegExp('開始測驗：.*&d=' + target.id));
});

console.log('\n[遊戲連結]');
await t('/玩 回傳帶 token 的連結', async () => {
  const u = await reload();
  const out = await say('/玩');
  assert.match(out, new RegExp('https://game\\.example\\.com\\?t=' + u.web_token));
});
await t('說明可取得', async () => assert.match(await say('/說明'), /怎麼加單字/));

console.log('\n[資料隔離]');
await t('token 只能查到自己的題庫', async () => {
  const u = await DB.getUserByToken(db, (await reload()).web_token);
  assert.equal(u.line_user_id, UID);
});

console.log(`\n總計：${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
