/** D1 資料庫存取 */

const now = () => Date.now();

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 取得使用者；不存在就建立（第一次傳訊息時） */
export async function ensureUser(db, lineUserId, displayName) {
  const found = await db.prepare('SELECT * FROM users WHERE line_user_id = ?')
    .bind(lineUserId).first();
  if (found) {
    if (displayName && displayName !== found.display_name) {
      await db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE line_user_id = ?')
        .bind(displayName, now(), lineUserId).run();
      found.display_name = displayName;
    }
    return found;
  }
  const token = randomToken();
  const ts = now();
  await db.prepare(
    'INSERT INTO users (line_user_id, display_name, current_deck_id, web_token, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)'
  ).bind(lineUserId, displayName || '', token, ts, ts).run();
  return { line_user_id: lineUserId, display_name: displayName || '', current_deck_id: null, web_token: token, created_at: ts, updated_at: ts };
}

export async function getUserByToken(db, token) {
  return db.prepare('SELECT * FROM users WHERE web_token = ?').bind(token).first();
}

export async function listDecks(db, lineUserId) {
  const { results } = await db.prepare(
    `SELECT d.id, d.name, d.created_at, COUNT(w.id) AS word_count
       FROM decks d LEFT JOIN words w ON w.deck_id = d.id
      WHERE d.line_user_id = ?
      GROUP BY d.id
      ORDER BY d.created_at`
  ).bind(lineUserId).all();
  return results || [];
}

export async function getDeckByName(db, lineUserId, name) {
  return db.prepare('SELECT * FROM decks WHERE line_user_id = ? AND name = ?')
    .bind(lineUserId, name).first();
}

export async function getDeck(db, deckId) {
  return db.prepare('SELECT * FROM decks WHERE id = ?').bind(deckId).first();
}

export async function createDeck(db, lineUserId, name) {
  const exists = await getDeckByName(db, lineUserId, name);
  if (exists) return { deck: exists, created: false };
  const res = await db.prepare('INSERT INTO decks (line_user_id, name, created_at) VALUES (?, ?, ?)')
    .bind(lineUserId, name, now()).run();
  const id = res.meta.last_row_id;
  return { deck: { id, line_user_id: lineUserId, name }, created: true };
}

export async function deleteDeck(db, lineUserId, deckId) {
  await db.prepare('DELETE FROM words WHERE deck_id = ?').bind(deckId).run();
  await db.prepare('DELETE FROM decks WHERE id = ? AND line_user_id = ?').bind(deckId, lineUserId).run();
  await db.prepare('UPDATE users SET current_deck_id = NULL WHERE line_user_id = ? AND current_deck_id = ?')
    .bind(lineUserId, deckId).run();
}

export async function setCurrentDeck(db, lineUserId, deckId) {
  await db.prepare('UPDATE users SET current_deck_id = ?, updated_at = ? WHERE line_user_id = ?')
    .bind(deckId, now(), lineUserId).run();
}

export async function listWords(db, deckId) {
  const { results } = await db.prepare(
    'SELECT word, zh, ipa, hint FROM words WHERE deck_id = ? ORDER BY created_at'
  ).bind(deckId).all();
  return results || [];
}

/** 批次查音標：一次查完整批，避免逐字往返 */
export async function lookupIpaMany(db, words) {
  const keys = [...new Set(words.flatMap((w) => w.split(/[\s\-]+/).filter(Boolean)))];
  if (!keys.length) return {};
  const map = {};
  // D1 的參數數量有限，分批查
  for (let i = 0; i < keys.length; i += 80) {
    const chunk = keys.slice(i, i + 80);
    const holes = chunk.map(() => '?').join(',');
    const { results } = await db.prepare(`SELECT word, ipa FROM dict WHERE word IN (${holes})`)
      .bind(...chunk).all();
    (results || []).forEach((r) => { map[r.word] = r.ipa; });
  }
  // 片語逐段組合，任何一段查不到就整體放棄
  const out = {};
  for (const w of words) {
    const parts = w.split(/[\s\-]+/).filter(Boolean);
    const got = parts.map((p) => map[p]);
    out[w] = got.every(Boolean) ? '/' + got.join(' ') + '/' : '';
  }
  return out;
}

/**
 * 寫入單字。已存在的會被略過（不覆蓋既有中文）。
 * @returns {{added: number, dup: number}}
 */
export async function addWords(db, deckId, entries, source) {
  if (!entries.length) return { added: 0, dup: 0 };

  const ipaMap = await lookupIpaMany(db, entries.map((e) => e.word));
  const ts = now();
  const stmt = db.prepare(
    `INSERT INTO words (deck_id, word, zh, ipa, hint, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (deck_id, word) DO NOTHING`
  );

  const batch = entries.map((e) => stmt.bind(
    deckId, e.word, e.zh || '', ipaMap[e.word] || '', e.hint || '', source || 'text', ts
  ));
  const results = await db.batch(batch);

  let added = 0;
  results.forEach((r) => { if (r.meta && r.meta.changes) added += r.meta.changes; });
  return { added, dup: entries.length - added, ipaMap };
}

export async function removeWord(db, deckId, word) {
  const res = await db.prepare('DELETE FROM words WHERE deck_id = ? AND word = ?')
    .bind(deckId, word).run();
  return res.meta.changes > 0;
}
