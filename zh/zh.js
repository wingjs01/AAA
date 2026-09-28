/* =========================================================
   國字練習 — 看注音寫國字（跟英文單字遊戲完全獨立的頁面）
   - 題庫：美里 API，只讀 lang=zh 的生字題庫
   - 寫字：Hanzi Writer 逐筆檢查筆順；寫錯只提示、不扣機會，錯的筆數影響分數
   - 同一筆錯 3 次自動補上，避免台灣與大陸筆順不同的字把小朋友卡住
   ========================================================= */
(function () {
  'use strict';

  var TOKEN_KEY = 'zhquiz.token';
  var ROUNDS_KEY = 'zhquiz.rounds';
  var HW_SRC = 'https://cdn.jsdelivr.net/npm/hanzi-writer@3.7.3/dist/hanzi-writer.min.js';

  var $ = function (id) { return document.getElementById(id); };
  var screens = { start: $('screen-start'), write: $('screen-write'), over: $('screen-over') };

  var state = null;        // 練習進行中的狀態
  var lastSource = null;   // 「再練一次」用
  var nextAction = null;   // 「下一題」按鈕要做的事
  var mine = { ready: false, token: null, decks: [], error: '' };
  var pub = { ready: false, decks: [], error: '' };

  /* ---------- 小工具 ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function show(name) {
    Object.keys(screens).forEach(function (k) { screens[k].classList.toggle('is-active', k === name); });
    window.scrollTo(0, 0);
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function rounds() {
    var v = parseInt($('roundsRange').value, 10);
    return Math.max(5, Math.min(100, v || 10));
  }

  var audio = null;
  function beepWin() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [523, 659, 784, 1046].forEach(function (f, i) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = f; g.gain.value = 0.06;
        o.connect(g); g.connect(audio.destination);
        var t = audio.currentTime + i * 0.11;
        o.start(t); o.stop(t + 0.16);
      });
    } catch (e) {}
  }

  /* ---------- 題庫 API（只讀中文生字）---------- */
  var params = new URLSearchParams(window.location.search);
  var urlToken = params.get('t');
  var autoDeck = params.get('d');
  if (urlToken || autoDeck) {           // 收下後把網址列清掉，連結不會被看到或分享出去
    if (urlToken) store(TOKEN_KEY, urlToken);
    try { window.history.replaceState({}, '', window.location.pathname); } catch (e) {}
  }

  function api(path) {
    var sep = path.indexOf('?') === -1 ? '?' : '&';
    return fetch(API_BASE + path + sep + 'lang=zh', {
      headers: { 'ngrok-skip-browser-warning': 'true' }   // ngrok 免費版沒帶會回警告頁
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 401 ? '連結已失效' : '連線失敗（' + r.status + '）');
      return r.json();
    });
  }

  function loadMine() {
    var tok = load(TOKEN_KEY);
    if (!tok) { mine = { ready: true, token: null, decks: [], error: '' }; return Promise.resolve(); }
    mine.ready = false;
    return api('/api/decks?t=' + encodeURIComponent(tok)).then(function (d) {
      mine = { ready: true, token: tok, decks: d.decks || [], error: '' };
    }).catch(function (e) {
      mine = { ready: true, token: tok, decks: [], error: e.message };
    });
  }

  function loadPublic() {
    return api('/api/public').then(function (d) {
      pub = { ready: true, decks: d.decks || [], error: '' };
    }).catch(function (e) {
      pub = { ready: true, decks: [], error: e.message };
    });
  }

  /* ---------- 開始畫面 ---------- */
  function deckCard(deck, owner, onPlay) {
    var n = Math.min(rounds(), deck.word_count);
    var row = document.createElement('div');
    row.className = 'deck-card';
    row.innerHTML =
      '<span class="d-text">' +
        '<span class="d-name">' + esc(deck.name) + '</span>' +
        '<span class="d-desc">' + deck.word_count + ' 個生字・' +
          (n ? '一次 ' + n + ' 題' : '還沒有生字') +
          (owner ? '・由 ' + esc(owner) + ' 分享' : '') + '</span>' +
      '</span>' +
      '<button class="btn btn-sm" type="button" ' + (n ? '' : 'disabled') + '>▶ 開始</button>';
    row.querySelector('button').addEventListener('click', onPlay);
    return row;
  }

  function renderMine() {
    var box = $('myDecks');
    box.innerHTML = '';
    if (!mine.ready) { box.innerHTML = '<div class="note">正在讀取你的生字題庫…</div>'; return; }
    if (mine.error) {
      box.innerHTML = '<div class="note">讀不到題庫：' + esc(mine.error) +
        '<br>請在 LINE 輸入 <b>!生字 測驗</b> 取得新的連結。</div>';
      return;
    }
    if (!mine.token) {
      box.innerHTML = '<div class="note">還沒有連結 LINE 帳號。<br>在 LINE 輸入 <b>!生字 測驗</b> 取得你的專屬連結。</div>';
      return;
    }
    if (!mine.decks.length) {
      box.innerHTML = '<div class="note">還沒有生字題庫。<br>在 LINE 傳 <b>生字 第一課 蘋果 太陽</b> 建一個。</div>';
      return;
    }
    mine.decks.forEach(function (deck) {
      box.appendChild(deckCard(deck, '', function () {
        start({ kind: 'mine', id: deck.id, name: deck.name });
      }));
    });
  }

  function renderPublic() {
    var head = $('publicHead'), box = $('publicDecks');
    var empty = pub.ready && !pub.error && !pub.decks.length;
    head.hidden = box.hidden = empty;               // 沒人公開 → 整區不出現
    if (empty) return;
    box.innerHTML = '';
    if (!pub.ready) { box.innerHTML = '<div class="note">正在讀取公開題庫…</div>'; return; }
    if (pub.error) { box.innerHTML = '<div class="note">讀不到公開題庫：' + esc(pub.error) + '</div>'; return; }
    pub.decks.forEach(function (deck) {
      box.appendChild(deckCard(deck, deck.owner || '匿名', function () {
        start({ kind: 'public', id: deck.id, name: deck.name + '（' + (deck.owner || '匿名') + '）' });
      }));
    });
  }

  function renderStart() { renderMine(); renderPublic(); }

  /* ---------- 開始練習 ---------- */
  var hwLoading = null;
  function loadHanziWriter() {
    if (window.HanziWriter) return Promise.resolve();
    if (!hwLoading) {
      hwLoading = new Promise(function (resolve, reject) {
        var sc = document.createElement('script');
        sc.src = HW_SRC;
        sc.onload = function () { resolve(); };
        sc.onerror = function () { hwLoading = null; reject(new Error('寫字元件載入失敗，請檢查網路')); };
        document.head.appendChild(sc);
      });
    }
    return hwLoading;
  }

  function start(source) {
    lastSource = source;
    var path = source.kind === 'public'
      ? '/api/public/' + encodeURIComponent(source.id)
      : '/api/deck/' + encodeURIComponent(source.id) + '?t=' + encodeURIComponent(mine.token);
    Promise.all([api(path), loadHanziWriter()]).then(function (res) {
      var words = (res[0].words || []).filter(function (w) {
        return w.word && (w.zhuyin || []).length === Array.from(w.word).length;
      });
      if (!words.length) { window.alert('這個題庫還沒有生字。'); return; }
      state = {
        label: source.name,
        queue: shuffle(words).slice(0, Math.min(rounds(), words.length)),
        round: 0, score: 0, perfect: 0, results: []
      };
      $('hudDeck').textContent = source.name;
      show('write');
      loadRound();
    }).catch(function (e) { window.alert('載入失敗：' + e.message); });
  }

  function msg(text, kind) {
    var el = $('msg');
    el.textContent = text || '';
    el.className = 'message' + (kind ? ' ' + kind : '');
  }

  function loadRound() {
    var item = state.queue[state.round];
    state.word = item.word;
    state.chars = Array.from(item.word);
    state.zy = item.zhuyin || [];
    state.ci = 0;
    state.wrong = 0;
    state.hintUsed = 0;
    state.locked = false;
    hideNext();
    $('hudRound').textContent = (state.round + 1) + ' / ' + state.queue.length;
    $('hudScore').textContent = state.score;
    $('btnHint').disabled = false;
    $('btnRedo').disabled = false;
    msg('');
    renderCells();
    startChar();
  }

  /** 上方一排格子：每格上面是注音，寫完的字填進去，目前這格亮起來 */
  function renderCells() {
    var box = $('cells');
    box.innerHTML = '';
    state.chars.forEach(function (ch, i) {
      var cell = document.createElement('div');
      cell.className = 'cell' + (i < state.ci ? ' done' : (i === state.ci && !state.locked ? ' current' : ''));
      cell.innerHTML =
        '<span class="zy">' + esc(state.zy[i] || '') + '</span>' +
        '<span class="ch">' + (i < state.ci ? esc(ch) : '') + '</span>';
      box.appendChild(cell);
    });
  }

  function padSize() {
    var w = $('padWrap').clientWidth || 300;
    return Math.max(200, Math.min(300, w - 8));
  }

  function startChar() {
    var ch = state.chars[state.ci];
    var pad = $('pad');
    var size = padSize();
    pad.innerHTML = '';
    pad.style.width = size + 'px';
    pad.style.height = size + 'px';
    msg('載入中…');
    state.writer = HanziWriter.create(pad, ch, {
      width: size,
      height: size,
      padding: 14,
      showCharacter: false,
      showOutline: false,
      strokeColor: '#47c98a',
      drawingColor: '#e7ecf5',
      highlightColor: '#f5b544',
      drawingWidth: 22,
      strokeAnimationSpeed: 3,          // 看筆順動畫：預設 14 筆的「銀」要播快 20 秒 → 加快
      delayBetweenStrokes: 120,
      showHintAfterMisses: 2,           // 同一筆錯 2 次 → 閃一下正確的那一筆
      markStrokeCorrectAfterMisses: 3,  // 錯 3 次 → 直接補上，不讓人卡住
      // 筆順資料從 CDN 下載，網路慢時格子會先空著、寫了沒反應 → 先講「載入中」
      onLoadCharDataSuccess: function () { if ($('msg').textContent === '載入中…') msg(''); },
      onLoadCharDataError: function () {
        // 少數字沒有筆順資料：直接算這個字過關，不讓整題卡死
        msg('「' + ch + '」沒有筆順資料，先幫你寫上', 'bad');
        setTimeout(charDone, 900);
      }
    });
    quizChar();
  }

  // ⚠️ 同一筆第 3 次錯時 Hanzi Writer 不呼叫 onMistake，而是直接當成寫對（onCorrectStroke、
  //    mistakesOnStroke=2）並補上那一筆——分不出「真的寫對」還是「被補上」，訊息用中性說法。
  function quizChar() {
    state.writer.quiz({
      onMistake: function (sd) {
        state.wrong++;
        msg(sd.mistakesOnStroke >= 2 ? '看一下閃出來的提示，照著寫' : '這一筆不對，再試試看', 'bad');
      },
      onCorrectStroke: function (sd) {
        msg(sd.mistakesOnStroke >= 2 ? '好，這一筆過了，繼續寫下一筆' : '');
      },
      onComplete: function () { setTimeout(charDone, 350); }
    });
  }

  function charDone() {
    if (!state || state.locked) return;
    state.ci++;
    if (state.ci < state.chars.length) {
      renderCells();
      msg('');
      startChar();
      return;
    }
    wordDone();
  }

  function wordDone() {
    state.locked = true;
    renderCells();
    $('btnHint').disabled = true;
    $('btnRedo').disabled = true;

    var gained = Math.max(20, 100 - state.wrong * 5 - state.hintUsed * 25);
    var flawless = (state.wrong === 0 && state.hintUsed === 0);
    if (flawless) { gained += 30; state.perfect++; }
    state.score += gained;
    $('hudScore').textContent = state.score;
    state.results.push({ word: state.word, zy: state.zy.join(' '), wrong: state.wrong, hint: state.hintUsed });
    beepWin();
    msg((flawless ? '完美！一筆都沒錯 ' : '寫完了！ ') + '+' + gained + ' 分', 'good');

    var last = state.round + 1 >= state.queue.length;
    showNext(last ? '看結果 🏆' : '下一題 ▶', function () {
      state.round++;
      if (state.round >= state.queue.length) gameOver();
      else loadRound();
    });
  }

  /* ---------- 「下一題」按鈕：寫完一個詞，看完再自己點 ---------- */
  function showNext(label, fn) {
    nextAction = fn;
    $('btnNext').textContent = label;
    $('nextRow').hidden = false;
    $('btnNext').focus();
  }
  function hideNext() {
    nextAction = null;
    $('nextRow').hidden = true;
  }
  function goNext() {
    var fn = nextAction;
    if (!fn) return;
    hideNext();
    fn();
  }

  /** 💡 看筆順：播一次這個字的寫法，播完這個字從頭再寫（扣分） */
  function showHint() {
    if (!state || state.locked || !state.writer) return;
    state.hintUsed++;
    $('btnHint').disabled = true;
    $('btnRedo').disabled = true;
    msg('看好筆順，等一下自己寫一次');
    var writer = state.writer;
    var finished = false;
    function backToQuiz() {
      if (finished) return;
      finished = true;
      clearTimeout(guard);
      setTimeout(function () {
        if (!state || state.locked || state.writer !== writer) return;
        writer.hideCharacter();
        $('btnHint').disabled = false;
        $('btnRedo').disabled = false;
        msg('換你寫');
        quizChar();
      }, 500);
    }
    // ⚠️ 保險：動畫靠 requestAnimationFrame，手機切到別的 App／分頁被藏起來時會停住、
    //    onComplete 永遠不來 → 按鈕一直是灰的、整題卡死（測試時實際踩到）。逾時就強制回到寫字。
    var guard = setTimeout(backToQuiz, 15000);
    writer.cancelQuiz();
    writer.animateCharacter({ onComplete: backToQuiz });
  }

  function redo() {
    if (!state || state.locked || !state.writer) return;
    state.writer.cancelQuiz();
    msg('這個字重新寫');
    quizChar();
  }

  function speak() {
    if (!state || !state.word || !window.speechSynthesis) return;
    try {
      var u = new SpeechSynthesisUtterance(state.word);
      u.lang = 'zh-TW';
      u.rate = 0.8;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* ---------- 結算 ---------- */
  function gameOver() {
    $('overText').textContent = '「' + state.label + '」的 ' + state.queue.length + ' 個生字都寫完了。';
    $('finalScore').textContent = state.score;
    $('finalDone').textContent = state.results.length + ' / ' + state.queue.length;
    $('finalPerfect').textContent = state.perfect;
    var list = $('reviewList');
    list.innerHTML = '';
    state.results.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'review-row';
      row.innerHTML =
        '<span class="rw-word">' + esc(r.word) + '</span>' +
        '<span class="rw-zy">' + esc(r.zy) + '</span>' +
        '<span class="rw-mark">' + (r.wrong ? '錯 ' + r.wrong + ' 筆' : '全對') +
          (r.hint ? '・看筆順 ' + r.hint + ' 次' : '') + '</span>';
      list.appendChild(row);
    });
    show('over');
  }

  /* ---------- 事件 ---------- */
  $('btnNext').addEventListener('click', goNext);
  $('btnHint').addEventListener('click', showHint);
  $('btnRedo').addEventListener('click', redo);
  $('btnSpeak').addEventListener('click', speak);
  $('btnQuit').addEventListener('click', function () {
    if (!state) return;
    if (window.confirm('結束這次練習？目前分數不會保留。')) {
      state.locked = true;
      if (state.writer) { try { state.writer.cancelQuiz(); } catch (e) {} }
      renderStart(); show('start');
    }
  });
  $('btnRetry').addEventListener('click', function () { if (lastSource) start(lastSource); });
  $('btnHome').addEventListener('click', function () { renderStart(); show('start'); });
  $('btnRefresh').addEventListener('click', function () {
    mine.ready = false; renderMine();
    loadMine().then(renderMine);
    loadPublic().then(renderPublic);
  });
  document.addEventListener('keydown', function (e) {
    if (screens.write.classList.contains('is-active') && nextAction &&
        (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();          // 按鈕已 focus，擋掉避免 Enter 觸發兩次
      goNext();
    }
  });

  (function initRounds() {
    var el = $('roundsRange'), out = $('roundsValue');
    var saved = parseInt(load(ROUNDS_KEY), 10);
    if (saved && !isNaN(saved)) el.value = Math.max(5, Math.min(100, saved));
    out.textContent = el.value;
    el.addEventListener('input', function () {
      out.textContent = el.value;
      store(ROUNDS_KEY, el.value);
      renderStart();
    });
  })();

  /* ---------- 啟動 ---------- */
  renderStart();
  show('start');
  loadPublic().then(renderPublic);
  loadMine().then(function () {
    renderMine();
    if (!autoDeck) return;          // 從 LINE 的練習連結進來：直接開始那一份
    var deck = mine.decks.filter(function (d) { return d.id === autoDeck; })[0];
    if (deck && deck.word_count > 0) start({ kind: 'mine', id: deck.id, name: deck.name });
  });
})();
