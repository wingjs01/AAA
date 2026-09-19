/**
 * LINE 訊息解析：指令、單字清單
 * 純函式、無外部相依，方便單獨測試
 */

/** 中日韓文字範圍（用來判斷英文與中文的分界） */
const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;

/** 明確的分隔符號：tab、半形/全形逗號、等號、冒號、頓號 */
const EXPLICIT_SEP = /[\t,，=:：、]/;

const COMMANDS = {
  '說明': 'help',   'help': 'help',   '?': 'help',
  '題庫': 'decks',  'decks': 'decks',
  '新增': 'new',    'new': 'new',
  '切換': 'switch', 'switch': 'switch',
  '刪除': 'remove', 'delete': 'remove',
  '清單': 'list',   'list': 'list',
  '移除': 'unword',
  '玩': 'play',     'play': 'play'
};

/**
 * 解析指令。指令以 / 或 ／ 開頭。
 * @returns {{cmd: string, arg: string}|null} 不是指令就回傳 null
 */
export function parseCommand(text) {
  const line = String(text || '').trim();
  if (!/^[/／]/.test(line)) return null;

  const body = line.slice(1).trim();
  if (!body) return { cmd: 'help', arg: '' };

  // 指令與參數之間可以用空白或全形空白分隔
  const m = body.match(/^(\S+)\s*([\s\S]*)$/);
  const raw = (m ? m[1] : body).toLowerCase();
  const arg = (m ? m[2] : '').trim();

  const cmd = COMMANDS[raw] || COMMANDS[m ? m[1] : body];
  return cmd ? { cmd, arg } : { cmd: 'unknown', arg: raw };
}

/**
 * 檢查並正規化單字。
 * 允許 a–z、空白、連字號、撇號；至少兩個字母。
 * @returns {{word: string}|{error: string}}
 */
export function normalizeWord(raw) {
  const w = String(raw || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .trim()
    .replace(/\s+/g, ' ');

  if (!w) return { error: '沒有英文單字' };
  if (/[0-9]/.test(w)) return { error: '不能包含數字' };
  if (!/^[a-z'\- ]+$/.test(w)) return { error: '只能是英文字母、空白、連字號、撇號' };
  if (!/^[a-z]/.test(w) || !/[a-z]$/.test(w)) return { error: '開頭與結尾必須是英文字母' };
  if ((w.match(/[a-z]/g) || []).length < 2) return { error: '至少要有兩個字母' };
  return { word: w };
}

/**
 * 把一行拆成英文與中文兩段。
 * 先找明確分隔符號；沒有的話用「第一個中文字」當分界，
 * 這樣 "ice cream 冰淇淋" 這種帶空白的片語才不會被切錯。
 */
export function splitLine(line) {
  const text = String(line || '').trim();
  if (!text) return { en: '', zh: '' };

  const sepAt = text.search(EXPLICIT_SEP);
  if (sepAt >= 0) {
    return {
      en: text.slice(0, sepAt).trim(),
      zh: text.slice(sepAt + 1).trim()
    };
  }

  const cjkAt = text.search(CJK);
  if (cjkAt > 0) {
    return {
      en: text.slice(0, cjkAt).trim(),
      zh: text.slice(cjkAt).trim()
    };
  }

  return { en: text, zh: '' };
}

/**
 * 解析整段文字（可多行）成單字清單。
 * @returns {{ok: Array<{word,zh}>, bad: Array<{text,reason}>}}
 */
export function parseWordLines(text) {
  const ok = [];
  const bad = [];
  const seen = new Set();

  String(text || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;

    const { en, zh } = splitLine(line);
    const chk = normalizeWord(en);
    if (chk.error) {
      bad.push({ text: line, reason: chk.error });
      return;
    }
    if (seen.has(chk.word)) return;   // 同一則訊息裡的重複只留一筆
    seen.add(chk.word);
    ok.push({ word: chk.word, zh: zh });
  });

  return { ok, bad };
}

/** 題庫名稱驗證 */
export function normalizeDeckName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!name) return { error: '請給題庫一個名稱，例如：/新增 課本第一課' };
  if (name.length > 40) return { error: '題庫名稱請不要超過 40 個字' };
  return { name };
}
