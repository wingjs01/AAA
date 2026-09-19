/* =========================================================
   音標查詢：內建 CMU 發音辭典（117,449 字），完全離線
   資料按首字母切成 26 份，查到哪個字母才載入哪一份
   ========================================================= */
var IPA_DATA = {};

var IpaDict = (function () {
  'use strict';

  var cache = {};     // letter -> { word: ipa }
  var waiting = {};   // letter -> [callback]

  function ensureShard(letter, done) {
    if (cache[letter]) { done(cache[letter]); return; }
    if (!/^[a-z]$/.test(letter)) { done(null); return; }
    if (waiting[letter]) { waiting[letter].push(done); return; }

    waiting[letter] = [done];
    var s = document.createElement('script');
    s.src = 'ipa/' + letter + '.js';
    s.async = true;
    s.onload = function () {
      var map = {};
      var raw = IPA_DATA[letter] || '';
      var lines = raw.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var sp = lines[i].indexOf(' ');
        if (sp > 0) map[lines[i].slice(0, sp)] = lines[i].slice(sp + 1);
      }
      IPA_DATA[letter] = null;   // 釋放原始字串，只留解析後的表
      finish(letter, map);
    };
    s.onerror = function () { finish(letter, {}); };
    document.head.appendChild(s);
  }

  function finish(letter, map) {
    cache[letter] = map;
    var queue = waiting[letter] || [];
    delete waiting[letter];
    queue.forEach(function (cb) { cb(map); });
  }

  /**
   * 查一個單字或片語的音標。
   * 片語（含空白或連字號）會逐字查再組合，任何一段查不到就整體失敗。
   * @param {string} word
   * @param {function(string|null)} cb 例：'/ˈbʌt.ər.flaɪ/'，查無則 null
   */
  function lookup(word, cb) {
    var clean = String(word || '').toLowerCase().trim();
    if (!clean) { cb(null); return; }

    var parts = clean.split(/[\s\-]+/).filter(Boolean);
    if (!parts.length) { cb(null); return; }

    var letters = {};
    parts.forEach(function (p) { letters[p.charAt(0)] = true; });
    var need = Object.keys(letters);
    var loaded = 0;

    need.forEach(function (L) {
      ensureShard(L, function () {
        loaded++;
        if (loaded < need.length) return;

        var out = [];
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i];
          var map = cache[p.charAt(0)];
          var hit = map && map[p];
          if (!hit) { cb(null); return; }
          out.push(hit);
        }
        cb('/' + out.join(' ') + '/');
      });
    });
  }

  /** 預先載入某個字母的資料，讓之後的查詢瞬間完成 */
  function preload(letter) {
    if (/^[a-z]$/.test(letter)) ensureShard(letter, function () {});
  }

  return { lookup: lookup, preload: preload };
})();
