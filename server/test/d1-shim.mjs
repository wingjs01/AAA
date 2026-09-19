/**
 * 用真的 SQLite 模擬 Cloudflare D1，讓 SQL 本身也能被測到。
 * 重點：D1 的 .bind() 會回傳「新的」statement（官方 batch 範例依賴這個行為），
 * 所以這裡也必須每次 bind 都產生獨立物件，否則 batch 會全部綁到最後一組參數。
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function makeD1(schemaPath) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(schemaPath, 'utf8'));

  const make = (sql, args) => ({
    bind: (...a) => make(sql, a.map((v) => (v === undefined ? null : v))),
    async first() {
      const rows = sqlite.prepare(sql).all(...args);
      return rows.length ? { ...rows[0] } : null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...args).map((r) => ({ ...r })) };
    },
    async run() {
      const r = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
  });

  return {
    prepare: (sql) => make(sql, []),
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    _raw: sqlite
  };
}

export function seedDict(d1, pairs) {
  for (const [w, ipa] of pairs) {
    d1._raw.prepare('INSERT OR REPLACE INTO dict (word, ipa) VALUES (?, ?)').run(w, ipa);
  }
}
