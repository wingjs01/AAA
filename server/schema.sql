-- 單字吊人：LINE 題庫資料結構
-- 以 LINE userId 作為主要識別

CREATE TABLE IF NOT EXISTS users (
  line_user_id   TEXT PRIMARY KEY,
  display_name   TEXT,
  current_deck_id INTEGER,              -- 目前正在收單字的題庫
  web_token      TEXT UNIQUE,           -- 專屬連結用的隨機字串
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS decks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT NOT NULL,
  name         TEXT NOT NULL,           -- 例：課本第一課、社團第一課
  created_at   INTEGER NOT NULL,
  UNIQUE (line_user_id, name),
  FOREIGN KEY (line_user_id) REFERENCES users(line_user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS words (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id    INTEGER NOT NULL,
  word       TEXT NOT NULL,             -- 一律小寫
  zh         TEXT NOT NULL DEFAULT '',
  ipa        TEXT NOT NULL DEFAULT '',
  hint       TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT 'text',  -- text | image
  created_at INTEGER NOT NULL,
  UNIQUE (deck_id, word),
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
);

-- CMU 發音辭典（117,449 字），供 bot 自動補音標
CREATE TABLE IF NOT EXISTS dict (
  word TEXT PRIMARY KEY,
  ipa  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decks_user  ON decks(line_user_id);
CREATE INDEX IF NOT EXISTS idx_words_deck  ON words(deck_id);
