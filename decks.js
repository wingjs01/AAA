/* =========================================================
   自建字庫：存在瀏覽器 localStorage，離線可用
   結構：[{ id, name, createdAt, words: [{word, zh, ipa, hint}] }]
   ========================================================= */
var Decks = (function () {
  'use strict';

  var KEY = 'hangman.decks.v1';

  function readAll() {
    try {
      var raw = localStorage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeAll(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;   // 無痕視窗或空間不足
    }
  }

  function newId() {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function get(id) {
    var list = readAll();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function upsert(deck) {
    var list = readAll();
    var found = false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === deck.id) { list[i] = deck; found = true; break; }
    }
    if (!found) list.push(deck);
    return writeAll(list);
  }

  function remove(id) {
    return writeAll(readAll().filter(function (d) { return d.id !== id; }));
  }

  /**
   * 檢查並正規化使用者輸入的單字。
   * 允許 a–z、空白、連字號、撇號；其餘一律擋下（猜字鍵盤只有 26 個字母）。
   * @returns {{word:string}|{error:string}}
   */
  function normalizeWord(raw) {
    var w = String(raw || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (!w) return { error: '請輸入單字' };
    if (/[0-9]/.test(w)) return { error: '單字不能包含數字' };
    if (!/^[a-z'’\- ]+$/.test(w)) return { error: '只能使用英文字母、空白、連字號與撇號' };
    if (!/^[a-z]/.test(w) || !/[a-z]$/.test(w)) return { error: '單字的開頭與結尾必須是英文字母' };
    if ((w.match(/[a-z]/g) || []).length < 2) return { error: '單字至少要有兩個字母' };
    return { word: w };
  }

  /** 計算一筆單字裡可猜的字母數 */
  function letterCount(word) {
    return (String(word).match(/[a-z]/g) || []).length;
  }

  /** 這個字庫一局要玩幾關（最多 5 關，字不夠就有幾個玩幾關） */
  function roundsOf(deck) {
    return Math.min(5, (deck && deck.words ? deck.words.length : 0));
  }

  function exportJson(deck) {
    return JSON.stringify({
      format: 'hangman-deck',
      version: 1,
      name: deck.name,
      exportedAt: new Date().toISOString(),
      words: deck.words
    }, null, 2);
  }

  /** 讀回備份檔，回傳 {name, words} 或 {error} */
  function importJson(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return { error: '檔案不是有效的備份格式' }; }
    if (!data || !Array.isArray(data.words)) return { error: '備份檔裡找不到單字清單' };

    var words = [], skipped = 0;
    data.words.forEach(function (row) {
      if (!row || typeof row.word !== 'string') { skipped++; return; }
      var chk = normalizeWord(row.word);
      if (chk.error) { skipped++; return; }
      words.push({
        word: chk.word,
        zh: String(row.zh || ''),
        ipa: String(row.ipa || ''),
        hint: String(row.hint || '')
      });
    });
    if (!words.length) return { error: '備份檔裡沒有可用的單字' };
    return { name: String(data.name || '還原的字庫'), words: words, skipped: skipped };
  }

  return {
    list: readAll,
    get: get,
    upsert: upsert,
    remove: remove,
    newId: newId,
    normalizeWord: normalizeWord,
    letterCount: letterCount,
    roundsOf: roundsOf,
    exportJson: exportJson,
    importJson: importJson
  };
})();
