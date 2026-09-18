/* =========================================================
   單字吊人 — 遊戲主程式
   ========================================================= */
(function () {
  'use strict';

  var MAX_WRONG = 6;           // 人形共 6 個部位，滿 6 次就被吊死
  var LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var screens = {
    start: $('screen-start'),
    game:  $('screen-game'),
    over:  $('screen-over')
  };

  /* ---------- 狀態 ---------- */
  var state = null;

  function newState(level) {
    return {
      level: level,
      queue: pickWords(level, DIFFICULTY_META[level].rounds),
      round: 0,          // 目前第幾關（0-based）
      score: 0,
      perfect: 0,
      results: [],       // 每關結果，用於結算複習
      // 單關資料
      word: '',
      guessed: {},       // 已按過的字母
      found: {},         // 已猜中的字母
      hinted: {},        // 靠提示揭開的字母
      wrong: 0,
      hintUsed: 0,
      locked: false      // 動畫/結算期間鎖住輸入
    };
  }

  /* ---------- 工具 ---------- */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function pickWords(level, n) {
    return shuffle(WORD_BANK[level]).slice(0, n);
  }

  function show(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('is-active', k === name);
    });
    window.scrollTo(0, 0);
  }

  /* ---------- 音效（WebAudio，免外部檔案） ---------- */
  var audioCtx = null;
  function beep(freq, dur, type, vol) {
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol || 0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + dur);
    } catch (e) { /* 靜音失敗不影響遊戲 */ }
  }
  var sfx = {
    hit:  function () { beep(660, 0.14, 'sine'); },
    miss: function () { beep(180, 0.26, 'sawtooth', 0.05); },
    win:  function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { beep(f, 0.18); }, i * 110); }); },
    lose: function () { [330, 262, 196, 131].forEach(function (f, i) { setTimeout(function () { beep(f, 0.34, 'triangle', 0.07); }, i * 190); }); }
  };

  /* ---------- 發音 ---------- */
  function speak(word) {
    if (!('speechSynthesis' in window)) {
      setMessage('這個瀏覽器不支援朗讀功能', 'bad');
      return;
    }
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.85;
    window.speechSynthesis.speak(u);
  }

  /* ---------- 開始畫面 ---------- */
  function buildDifficulty() {
    var box = $('difficultyList');
    box.innerHTML = '';
    Object.keys(DIFFICULTY_META).forEach(function (level) {
      var meta = DIFFICULTY_META[level];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'diff-btn';
      btn.setAttribute('data-level', level);
      btn.innerHTML =
        '<span class="dot"></span>' +
        '<span class="d-text">' +
          '<span class="d-name">' + meta.label + '</span>' +
          '<span class="d-desc">' + meta.desc + '・共 ' + meta.rounds + ' 關</span>' +
        '</span>';
      btn.addEventListener('click', function () { startGame(level); });
      box.appendChild(btn);
    });
  }

  /* ---------- 遊戲流程 ---------- */
  function startGame(level) {
    state = newState(level);
    $('hudDiff').textContent = DIFFICULTY_META[level].label;
    show('game');
    loadRound();
  }

  function loadRound() {
    var item = state.queue[state.round];
    state.word = item.word;
    state.guessed = {};
    state.found = {};
    state.hinted = {};
    state.wrong = 0;
    state.hintUsed = 0;
    state.locked = false;

    $('hudRound').textContent = (state.round + 1) + ' / ' + state.queue.length;
    $('hudScore').textContent = state.score;
    $('clueZh').textContent = item.zh;
    $('clueIpa').textContent = item.ipa;
    $('clueLen').textContent = item.word.length + ' 個字母';
    $('sentence').innerHTML = '';
    $('btnSentence').disabled = (state.level === 'hard');
    $('btnSentence').textContent = state.level === 'hard'
      ? '📖 困難模式無例句'
      : '📖 例句';
    $('btnHint').disabled = false;

    setMessage('');
    buildKeyboard();
    renderSlots();
    renderWrong();
    renderHangman();
    renderLives();
  }

  function buildKeyboard() {
    var kb = $('keyboard');
    kb.innerHTML = '';
    LETTERS.forEach(function (ch) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'key';
      b.textContent = ch;
      b.setAttribute('data-letter', ch);
      b.addEventListener('click', function () { guess(ch); });
      kb.appendChild(b);
    });
  }

  function renderSlots(revealAll) {
    var box = $('wordSlots');
    box.innerHTML = '';
    state.word.split('').forEach(function (ch) {
      var d = document.createElement('div');
      d.className = 'slot';
      if (state.found[ch]) {
        d.textContent = ch;
        d.className += state.hinted[ch] ? ' hinted' : ' filled';
      } else if (revealAll) {
        d.textContent = ch;
        d.className += ' reveal';
      }
      box.appendChild(d);
    });
  }

  function renderWrong() {
    var box = $('wrongLetters');
    box.innerHTML = '';
    Object.keys(state.guessed).forEach(function (ch) {
      if (state.word.indexOf(ch) === -1) {
        var s = document.createElement('span');
        s.textContent = ch;
        box.appendChild(s);
      }
    });
  }

  function renderHangman() {
    var svg = $('hangman');
    svg.classList.toggle('dead', state.wrong >= MAX_WRONG);
    var parts = svg.querySelectorAll('.part');
    Array.prototype.forEach.call(parts, function (p) {
      var idx = parseInt(p.getAttribute('data-part'), 10);
      p.classList.toggle('show', idx <= state.wrong);
    });
  }

  function renderLives() {
    var box = $('lifeDots');
    box.innerHTML = '';
    for (var i = 0; i < MAX_WRONG; i++) {
      var d = document.createElement('i');
      if (i < state.wrong) d.className = 'lost';
      box.appendChild(d);
    }
  }

  function setMessage(text, kind) {
    var el = $('message');
    el.textContent = text || '';
    el.className = 'message' + (kind ? ' ' + kind : '');
  }

  function markKey(ch, cls) {
    var k = document.querySelector('.key[data-letter="' + ch + '"]');
    if (k) { k.disabled = true; k.classList.add(cls); }
  }

  /* ---------- 猜字 ---------- */
  function guess(ch) {
    if (!state || state.locked) return;
    if (state.guessed[ch]) return;
    state.guessed[ch] = true;

    if (state.word.indexOf(ch) !== -1) {
      state.found[ch] = true;
      markKey(ch, 'hit');
      renderSlots();
      sfx.hit();
      setMessage('拼對了！', 'good');
      if (isSolved()) roundWin();
    } else {
      markKey(ch, 'miss');
      penalty('拼錯了，繩子上的人又長出一塊…');
    }
  }

  function penalty(text) {
    state.wrong++;
    renderWrong();
    renderHangman();
    renderLives();
    if (state.wrong >= MAX_WRONG) {
      sfx.lose();
      roundLose();
    } else {
      sfx.miss();
      setMessage(text + '（還剩 ' + (MAX_WRONG - state.wrong) + ' 次）', 'bad');
    }
  }

  function isSolved() {
    return state.word.split('').every(function (ch) { return state.found[ch]; });
  }

  /* ---------- 單關結束 ---------- */
  function roundWin() {
    state.locked = true;
    var gained = Math.max(20, 100 - state.wrong * 15 - state.hintUsed * 25);
    var flawless = (state.wrong === 0 && state.hintUsed === 0);
    if (flawless) { gained += 30; state.perfect++; }
    state.score += gained;
    $('hudScore').textContent = state.score;

    state.results.push({
      word: state.word,
      zh: state.queue[state.round].zh,
      ok: true,
      wrong: state.wrong,
      hint: state.hintUsed
    });

    sfx.win();
    setMessage((flawless ? '完美！零失誤 ' : '過關！ ') + '+' + gained + ' 分', 'good');
    disableAllKeys();

    setTimeout(function () {
      state.round++;
      if (state.round >= state.queue.length) {
        gameOver(true);
      } else {
        loadRound();
      }
    }, 1400);
  }

  function roundLose() {
    state.locked = true;
    renderSlots(true);
    disableAllKeys();
    setMessage('他被吊死了…答案是「' + state.word.toUpperCase() + '」', 'bad');

    state.results.push({
      word: state.word,
      zh: state.queue[state.round].zh,
      ok: false,
      wrong: state.wrong,
      hint: state.hintUsed
    });

    setTimeout(function () { gameOver(false); }, 2200);
  }

  function disableAllKeys() {
    Array.prototype.forEach.call(document.querySelectorAll('.key'), function (k) { k.disabled = true; });
    $('btnHint').disabled = true;
  }

  /* ---------- 整局結束 ---------- */
  function gameOver(win) {
    var cleared = state.results.filter(function (r) { return r.ok; }).length;

    $('overIcon').textContent = win ? '🏆' : '💀';
    $('overTitle').textContent = win ? '全部通關！' : '通關失敗';
    $('overTitle').className = 'over-title ' + (win ? 'win' : 'lose');
    $('overText').textContent = win
      ? '你在 ' + DIFFICULTY_META[state.level].label + ' 難度救下了所有人。'
      : '第 ' + (state.round + 1) + ' 關被吊死，挑戰到此結束。';

    $('finalScore').textContent = state.score;
    $('finalCleared').textContent = cleared + ' / ' + state.queue.length;
    $('finalPerfect').textContent = state.perfect;

    var list = $('reviewList');
    list.innerHTML = '';
    state.results.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'review-row ' + (r.ok ? 'ok' : 'fail');
      row.innerHTML =
        '<span class="rw-word">' + r.word.toUpperCase() + '</span>' +
        '<span class="rw-zh">' + r.zh + '</span>' +
        '<span class="rw-mark">' + (r.ok ? '過關・錯 ' + r.wrong + ' 次' : '失敗') + '</span>';
      list.appendChild(row);
    });

    show('over');
  }

  /* ---------- 提示 ---------- */
  function useHint() {
    if (!state || state.locked) return;
    var remain = state.word.split('').filter(function (ch) { return !state.found[ch]; });
    if (!remain.length) return;
    var ch = remain[Math.floor(Math.random() * remain.length)];

    state.hintUsed++;
    state.guessed[ch] = true;
    state.found[ch] = true;
    state.hinted[ch] = true;
    markKey(ch, 'hit');
    renderSlots();

    if (isSolved()) { roundWin(); return; }
    penalty('提示揭開了「' + ch.toUpperCase() + '」，代價是一次機會');
  }

  function showSentence() {
    if (!state || state.level === 'hard') return;
    var item = state.queue[state.round];
    $('sentence').innerHTML = item.hint.replace('___', '<b>___</b>');
  }

  /* ---------- 事件 ---------- */
  $('btnSpeak').addEventListener('click', function () {
    if (state) speak(state.word);
  });
  $('btnHint').addEventListener('click', useHint);
  $('btnSentence').addEventListener('click', showSentence);
  $('btnQuit').addEventListener('click', function () {
    if (!state) return;
    if (window.confirm('放棄這一局？目前分數不會保留。')) show('start');
  });
  $('btnRetry').addEventListener('click', function () {
    startGame(state ? state.level : 'easy');
  });
  $('btnHome').addEventListener('click', function () { show('start'); });

  document.addEventListener('keydown', function (e) {
    if (!screens.game.classList.contains('is-active')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var ch = e.key.toLowerCase();
    if (ch.length === 1 && ch >= 'a' && ch <= 'z') {
      e.preventDefault();
      guess(ch);
    }
  });

  /* ---------- 啟動 ---------- */
  buildDifficulty();
  show('start');
})();
