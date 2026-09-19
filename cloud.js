/* =========================================================
   LINE 題庫：向後端取得屬於這個 LINE 帳號的題庫
   後端沒設定（API_BASE 為空）時整個模組靜默停用，
   遊戲的內建字庫與本機自建字庫完全不受影響。
   ========================================================= */
var Cloud = (function () {
  'use strict';

  var TOKEN_KEY = 'hangman.lineToken.v1';
  var state = { ready: false, token: null, name: '', decks: [], error: '' };

  function enabled() {
    return typeof API_BASE === 'string' && API_BASE !== '';
  }

  function readStoredToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
  }

  function storeToken(t) {
    try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* 無痕視窗存不住，不影響本次使用 */ }
  }

  function forget() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    state = { ready: true, token: null, name: '', decks: [], error: '' };
  }

  /** 網址帶 ?t=... 時優先採用，並把它從網址列拿掉避免被看到或被分享出去 */
  function tokenFromUrl() {
    var t = new URLSearchParams(window.location.search).get('t');
    if (!t) return null;
    storeToken(t);
    try {
      var clean = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', clean);
    } catch (e) {}
    return t;
  }

  function get(path) {
    return fetch(API_BASE + path, { method: 'GET' }).then(function (res) {
      if (!res.ok) throw new Error(res.status === 401 ? '連結已失效' : '連線失敗（' + res.status + '）');
      return res.json();
    });
  }

  /** 只有設定了 LIFF_ID 才去載入 LINE 的 SDK，沒設定就完全不碰外部資源 */
  function loadLiffSdk() {
    if (typeof liff !== 'undefined') return Promise.resolve(true);
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
      s.onload = function () { resolve(true); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
  }

  /** 在 LINE 內開啟時用 LIFF 自動辨識身分 */
  function tryLiff() {
    if (typeof LIFF_ID !== 'string' || !LIFF_ID) return Promise.resolve(null);
    return loadLiffSdk().then(function (ok) {
      if (!ok || typeof liff === 'undefined') return null;
      return liff.init({ liffId: LIFF_ID })
      .then(function () {
        if (!liff.isLoggedIn()) { liff.login(); return null; }
        var idToken = liff.getIDToken();
        if (!idToken) return null;
        return fetch(API_BASE + '/api/liff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: idToken })
        }).then(function (r) { return r.ok ? r.json() : null; });
      })
        .catch(function () { return null; });   // LIFF 失敗就退回專屬連結模式
    });
  }

  /** 載入題庫清單。無論成功失敗都會 resolve，呼叫端看 state 決定怎麼顯示。 */
  function load() {
    if (!enabled()) { state.ready = true; return Promise.resolve(state); }

    return tryLiff().then(function (liffData) {
      if (liffData && liffData.token) {
        storeToken(liffData.token);
        state = { ready: true, token: liffData.token, name: liffData.name || '', decks: liffData.decks || [], error: '' };
        return state;
      }

      var token = tokenFromUrl() || readStoredToken();
      if (!token) { state.ready = true; return state; }

      return get('/api/decks?t=' + encodeURIComponent(token)).then(function (data) {
        state = { ready: true, token: token, name: data.name || '', decks: data.decks || [], error: '' };
        return state;
      }).catch(function (err) {
        state = { ready: true, token: token, name: '', decks: [], error: err.message };
        return state;
      });
    });
  }

  /** 取得某個題庫的單字，格式與本機字庫相同，遊戲端可以直接使用 */
  function loadWords(deckId) {
    return get('/api/deck/' + deckId + '?t=' + encodeURIComponent(state.token))
      .then(function (data) {
        return (data.words || []).map(function (w) {
          return { word: w.word, zh: w.zh || '', ipa: w.ipa || '', hint: w.hint || '' };
        });
      });
  }

  return {
    enabled: enabled,
    load: load,
    loadWords: loadWords,
    forget: forget,
    state: function () { return state; }
  };
})();
