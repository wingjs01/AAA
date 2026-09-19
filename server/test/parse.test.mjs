import { parseCommand, normalizeWord, splitLine, parseWordLines, normalizeDeckName } from '../src/parse.js';
import assert from 'node:assert';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.log('  ✗', name, '\n      ', e.message); }
};

console.log('\n[指令解析]');
t('/說明', () => assert.deepEqual(parseCommand('/說明'), { cmd: 'help', arg: '' }));
t('/新增 課本第一課', () => assert.deepEqual(parseCommand('/新增 課本第一課'), { cmd: 'new', arg: '課本第一課' }));
t('全形斜線 ／切換', () => assert.deepEqual(parseCommand('／切換 社團第一課'), { cmd: 'switch', arg: '社團第一課' }));
t('英文指令 /list', () => assert.deepEqual(parseCommand('/list'), { cmd: 'list', arg: '' }));
t('大小寫不拘 /HELP', () => assert.equal(parseCommand('/HELP').cmd, 'help'));
t('只有斜線 → help', () => assert.equal(parseCommand('/').cmd, 'help'));
t('未知指令', () => assert.equal(parseCommand('/xyz').cmd, 'unknown'));
t('一般文字不是指令', () => assert.equal(parseCommand('apple 蘋果'), null));
t('題庫名含空白保留', () => assert.equal(parseCommand('/新增 第 一 課').arg, '第 一 課'));

console.log('\n[英中分界]');
t('空白分隔', () => assert.deepEqual(splitLine('apple 蘋果'), { en: 'apple', zh: '蘋果' }));
t('片語不被切錯', () => assert.deepEqual(splitLine('ice cream 冰淇淋'), { en: 'ice cream', zh: '冰淇淋' }));
t('逗號分隔', () => assert.deepEqual(splitLine('banana,香蕉'), { en: 'banana', zh: '香蕉' }));
t('全形逗號', () => assert.deepEqual(splitLine('cherry，櫻桃'), { en: 'cherry', zh: '櫻桃' }));
t('等號', () => assert.deepEqual(splitLine('grape=葡萄'), { en: 'grape', zh: '葡萄' }));
t('全形冒號', () => assert.deepEqual(splitLine('melon：哈密瓜'), { en: 'melon', zh: '哈密瓜' }));
t('沒有中文', () => assert.deepEqual(splitLine('strawberry'), { en: 'strawberry', zh: '' }));
t('中文有空白也完整保留', () => assert.deepEqual(splitLine('run 跑步 奔跑'), { en: 'run', zh: '跑步 奔跑' }));
t('連字號單字', () => assert.deepEqual(splitLine('well-known 有名的'), { en: 'well-known', zh: '有名的' }));

console.log('\n[單字驗證]');
t('正常', () => assert.equal(normalizeWord('Apple').word, 'apple'));
t('去頭尾空白', () => assert.equal(normalizeWord('  dog  ').word, 'dog'));
t('片語', () => assert.equal(normalizeWord('ice  cream').word, 'ice cream'));
t('撇號正規化', () => assert.equal(normalizeWord('don’t').word, "don't"));
t('擋數字', () => assert.match(normalizeWord('abc123').error, /數字/));
t('擋符號', () => assert.match(normalizeWord('a@b').error, /英文字母/));
t('擋太短', () => assert.match(normalizeWord('a').error, /兩個字母/));
t('擋空字串', () => assert.ok(normalizeWord('').error));
t('擋結尾非字母', () => assert.ok(normalizeWord('apple-').error));

console.log('\n[多行解析]');
const r = parseWordLines(`apple 蘋果
banana,香蕉
ice cream 冰淇淋
strawberry
abc123 亂碼
apple 重複的蘋果

well-known 有名的`);
t('成功 5 筆', () => assert.equal(r.ok.length, 5));
t('失敗 1 筆', () => assert.equal(r.bad.length, 1));
t('重複自動略過', () => assert.equal(r.ok.filter(x => x.word === 'apple').length, 1));
t('片語正確', () => assert.deepEqual(r.ok[2], { word: 'ice cream', zh: '冰淇淋' }));
t('無中文留空', () => assert.deepEqual(r.ok[3], { word: 'strawberry', zh: '' }));
t('失敗原因正確', () => assert.match(r.bad[0].reason, /數字/));

console.log('\n[題庫名稱]');
t('正常', () => assert.equal(normalizeDeckName('課本第一課').name, '課本第一課'));
t('空白擋下', () => assert.ok(normalizeDeckName('   ').error));
t('過長擋下', () => assert.ok(normalizeDeckName('字'.repeat(41)).error));

console.log(`\n總計：${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
