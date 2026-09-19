/** 把 ipa/*.js 的辭典轉成 D1 可匯入的 SQL */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ipaDir = join(here, '..', '..', 'ipa');
const out = [];
let total = 0;

out.push('DELETE FROM dict;');

for (const c of 'abcdefghijklmnopqrstuvwxyz') {
  const src = readFileSync(join(ipaDir, `${c}.js`), 'utf8');
  const IPA_DATA = {};
  new Function('IPA_DATA', src)(IPA_DATA);

  const rows = [];
  for (const line of (IPA_DATA[c] || '').split('\n')) {
    const sp = line.indexOf(' ');
    if (sp <= 0) continue;
    const word = line.slice(0, sp).replace(/'/g, "''");
    const ipa = line.slice(sp + 1).replace(/'/g, "''");
    rows.push(`('${word}','${ipa}')`);
    total++;
  }
  // 每 500 筆一個 INSERT，避免單一敘述過長
  for (let i = 0; i < rows.length; i += 500) {
    out.push('INSERT INTO dict (word, ipa) VALUES ' + rows.slice(i, i + 500).join(',') + ';');
  }
}

const sql = out.join('\n') + '\n';
writeFileSync(join(here, '..', 'seed-dict.sql'), sql);
console.log(`已產生 seed-dict.sql：${total} 筆，${(sql.length / 1024 / 1024).toFixed(2)} MB`);
