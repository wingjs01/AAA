/* =========================================================
   單字吊人 — 遊戲主程式
   ========================================================= */
(function () {
  'use strict';

  var MAX_WRONG = 6;           // 人形共 6 個部位，滿 6 次就被吊死
  var MAX_ROUNDS = 5;
  var LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

  var $ = function (id) { return document.getElementById(id); };
  var screens = {
    start: $('screen-start'),
    deck:  $('screen-deck'),
    game:  $('screen-game'),
    over:  $('screen-over')
  };

  var state = null;       // 遊戲進行中的狀態
  var lastSource = null;  // 「再挑戰一次」用

  /* ---------- 共用小工具 ---------- */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function show(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('is-active', k === name);
    });
    window.scrollTo(0, 0);
  }

  function isLetter(ch) { return ch >= 'a' && ch <= 'z'; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- 音效 ---------- */
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
    } catch (e) { /* 沒有音效不影響遊戲 */ }
  }
  var sfx = {
    hit:  function () { beep(660, 0.14, 'sine'); },
    miss: function () { beep(180, 0.26, 'sawtooth', 0.05); },
    win:  function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { beep(f, 0.18); }, i * 110); }); },
    lose: function () { [330, 262, 196, 131].forEach(function (f, i) { setTimeout(function () { beep(f, 0.34, 'triangle', 0.07); }, i * 190); }); }
  };

  /* ---------- 發音 ---------- */
  function speak(word, onFail) {
    if (!('speechSynthesis' in window)) { if (onFail) onFail('這個瀏覽器不支援朗讀'); return; }
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.85;
    window.speechSynthesis.speak(u);
  }

  /* =========================================================
     開始畫面
     ========================================================= */
  function renderStart() {
    renderBuiltin();
    renderMyDecks();
    renderLineDecks();
  }

  /* ---------- LINE 題庫 ---------- */
  function renderLineDecks() {
    var head = $('lineHead');
    var box = $('lineDeckList');
    if (!Cloud.enabled()) { head.hidden = true; box.hidden = true; return; }

    var st = Cloud.state();
    head.hidden = false;
    box.hidden = false;
    box.innerHTML = '';

    if (!st.ready) {
      box.innerHTML = '<div class="empty-note">正在讀取你的 LINE 題庫…</div>';
      return;
    }
    if (st.error) {
      box.innerHTML = '<div class="empty-note">讀不到 LINE 題庫：' + esc(st.error) +
        '<br>請回到 LINE 輸入 <b>/玩</b> 取得新的連結。</div>';
      return;
    }
    if (!st.token) {
      box.innerHTML = '<div class="empty-note">還沒有連結 LINE 帳號。<br>' +
        '在 LINE 把單字或課本照片傳給 bot，再輸入 <b>/玩</b> 取得你的專屬連結。</div>';
      return;
    }
    if (!st.decks.length) {
      box.innerHTML = '<div class="empty-note">' + (st.name ? esc(st.name) + '，你' : '你') +
        '還沒有 LINE 題庫。<br>在 LINE 輸入「/新增 課本第一課」建立一個。</div>';
      return;
    }

    st.decks.forEach(function (deck) {
      var rounds = Math.min(MAX_ROUNDS, deck.word_count);
      var row = document.createElement('div');
      row.className = 'deck-card deck-card-custom';
      row.innerHTML =
        '<span class="dot dot-line"></span>' +
        '<span class="d-text">' +
          '<span class="d-name">' + esc(deck.name) + '</span>' +
          '<span class="d-desc">' + deck.word_count + ' 個單字・' +
            (rounds ? '一局 ' + rounds + ' 關' : '還沒有單字') + '</span>' +
        '</span>' +
        '<span class="card-actions">' +
          '<button class="btn btn-sm" data-act="play" ' + (rounds ? '' : 'disabled') + '>▶ 開始</button>' +
        '</span>';
      row.addEventListener('click', function (e) {
        if (e.target.getAttribute && e.target.getAttribute('data-act') === 'play') {
          startGame({ kind: 'cloud', deckId: deck.id, name: deck.name });
        }
      });
      box.appendChild(row);
    });
  }

  function renderBuiltin() {
    var box = $('difficultyList');
    box.innerHTML = '';
    Object.keys(DIFFICULTY_META).forEach(function (level) {
      var meta = DIFFICULTY_META[level];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'deck-card deck-card-btn';
      btn.setAttribute('data-level', level);
      btn.innerHTML =
        '<span class="dot"></span>' +
        '<span class="d-text">' +
          '<span class="d-name">' + meta.label + '</span>' +
          '<span class="d-desc">' + meta.desc + '・共 ' + meta.rounds + ' 關</span>' +
        '</span>';
      btn.addEventListener('click', function () {
        startGame({ kind: 'builtin', level: level });
      });
      box.appendChild(btn);
    });
  }

  function renderMyDecks() {
    var box = $('myDeckList');
    var list = Decks.list();
    box.innerHTML = '';

    if (!list.length) {
      box.innerHTML = '<div class="empty-note">還沒有自建字庫。按上面的「＋ 新增字庫」，' +
                      '打單字就好，音標和發音會自動幫你補上。</div>';
      return;
    }

    list.forEach(function (deck) {
      var rounds = Decks.roundsOf(deck);
      var row = document.createElement('div');
      row.className = 'deck-card deck-card-custom';
      row.innerHTML =
        '<span class="dot dot-mine"></span>' +
        '<span class="d-text">' +
          '<span class="d-name">' + esc(deck.name) + '</span>' +
          '<span class="d-desc">' + deck.words.length + ' 個單字・' +
            (rounds ? '一局 ' + rounds + ' 關' : '還沒有單字') + '</span>' +
        '</span>' +
        '<span class="card-actions">' +
          '<button class="btn btn-sm" data-act="play" ' + (rounds ? '' : 'disabled') + '>▶ 開始</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="edit" title="編輯">✎</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="del" title="刪除">🗑</button>' +
        '</span>';

      row.addEventListener('click', function (e) {
        var act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (!act) return;
        if (act === 'play') startGame({ kind: 'deck', id: deck.id });
        else if (act === 'edit') openEditor(deck.id);
        else if (act === 'del') {
          if (window.confirm('確定刪除字庫「' + deck.name + '」？裡面的 ' + deck.words.length + ' 個單字會一起消失，無法復原。')) {
            Decks.remove(deck.id);
            renderMyDecks();
          }
        }
      });
      box.appendChild(row);
    });
  }

  /* =========================================================
     字庫編輯畫面
     ========================================================= */
  var draft = null;        // 正在編輯的字庫
  var editIndex = -1;      // 正在修改第幾筆；-1 表示新增模式
  var ipaDirty = false;    // 使用者手動改過音標就不再自動覆蓋
  var ipaToken = 0;        // 丟棄過期的非同步查詢結果
  var ipaTimer = null;
  var dirty = false;       // 有未儲存的變更

  function openEditor(id) {
    var deck = id ? Decks.get(id) : null;
    draft = deck
      ? { id: deck.id, name: deck.name, createdAt: deck.createdAt, words: deck.words.slice() }
      : { id: Decks.newId(), name: '', createdAt: Date.now(), words: [] };
    dirty = false;
    $('deckName').value = draft.name;
    resetForm();
    renderDeckWords();
    show('deck');
    $('deckName').focus();
  }

  function resetForm() {
    editIndex = -1;
    ipaDirty = false;
    $('inWord').value = '';
    $('inZh').value = '';
    $('inIpa').value = '';
    $('inHint').value = '';
    $('formTitle').textContent = '新增單字';
    $('btnAddWord').textContent = '＋ 加入字庫';
    $('btnCancelEdit').hidden = true;
    setFieldMsg('');
    setIpaStatus('自動填入', '');
  }

  function setFieldMsg(text, kind) {
    var el = $('wordMsg');
    el.textContent = text || '';
    el.className = 'field-msg' + (kind ? ' ' + kind : '');
  }

  function setIpaStatus(text, kind) {
    var el = $('ipaStatus');
    el.textContent = text || '';
    el.className = 'field-auto' + (kind ? ' ' + kind : '');
  }

  function autoFillIpa() {
    var raw = $('inWord').value.trim();
    if (!raw) { setIpaStatus('自動填入', ''); return; }
    if (ipaDirty) return;

    var chk = Decks.normalizeWord(raw);
    if (chk.error) { setIpaStatus('自動填入', ''); return; }

    setIpaStatus('查詢中…', 'load');
    var token = ++ipaToken;
    IpaDict.lookup(chk.word, function (ipa) {
      if (token !== ipaToken || ipaDirty) return;
      if (ipa) {
        $('inIpa').value = ipa;
        setIpaStatus('已自動查到 ✓', 'ok');
      } else {
        $('inIpa').value = '';
        setIpaStatus('辭典查無，發音仍可用', 'warn');
      }
    });
  }

  function addOrUpdateWord() {
    var chk = Decks.normalizeWord($('inWord').value);
    if (chk.error) { setFieldMsg(chk.error, 'bad'); $('inWord').focus(); return; }

    // 檢查重複（修改自己那筆時不算重複）
    for (var i = 0; i < draft.words.length; i++) {
      if (draft.words[i].word === chk.word && i !== editIndex) {
        setFieldMsg('「' + chk.word + '」已經在這個字庫裡了', 'bad');
        return;
      }
    }

    var entry = {
      word: chk.word,
      zh: $('inZh').value.trim(),
      ipa: $('inIpa').value.trim(),
      hint: $('inHint').value.trim()
    };

    if (editIndex >= 0) draft.words[editIndex] = entry;
    else draft.words.push(entry);

    dirty = true;
    resetForm();
    renderDeckWords();
    $('inWord').focus();
  }

  function loadForEdit(idx) {
    var w = draft.words[idx];
    if (!w) return;
    editIndex = idx;
    ipaDirty = true;                 // 修改既有單字時不要蓋掉原本的音標
    $('inWord').value = w.word;
    $('inZh').value = w.zh || '';
    $('inIpa').value = w.ipa || '';
    $('inHint').value = w.hint || '';
    $('formTitle').textContent = '修改單字';
    $('btnAddWord').textContent = '儲存修改';
    $('btnCancelEdit').hidden = false;
    setFieldMsg('');
    setIpaStatus('手動編輯中', '');
    $('screen-deck').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('inWord').focus();
  }

  function renderDeckWords() {
    var box = $('deckWords');
    $('deckCount').textContent = draft.words.length;
    box.innerHTML = '';

    if (!draft.words.length) {
      box.innerHTML = '<div class="empty-note">這個字庫還是空的，用上面的表單加第一個單字吧。</div>';
      return;
    }

    draft.words.forEach(function (w, idx) {
      var row = document.createElement('div');
      row.className = 'word-row';
      row.innerHTML =
        '<span class="wr-word">' + esc(w.word.toUpperCase()) + '</span>' +
        '<span class="wr-ipa">' + esc(w.ipa || '') + '</span>' +
        '<span class="wr-zh">' + esc(w.zh || '（未填中文）') + '</span>' +
        '<span class="wr-acts">' +
          '<button class="btn btn-ghost btn-sm" data-act="speak" title="試聽">🔊</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="edit" title="修改">✎</button>' +
          '<button class="btn btn-ghost btn-sm" data-act="del" title="刪除">🗑</button>' +
        '</span>';
      row.addEventListener('click', function (e) {
        var act = e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'speak') speak(w.word);
        else if (act === 'edit') loadForEdit(idx);
        else if (act === 'del') {
          draft.words.splice(idx, 1);
          if (editIndex === idx) resetForm();
          dirty = true;
          renderDeckWords();
        }
      });
      box.appendChild(row);
    });
  }

  function saveDeck() {
    var name = $('deckName').value.trim();
    if (!name) { name = '未命名字庫'; $('deckName').value = name; }
    draft.name = name;

    if (Decks.upsert(draft)) {
      dirty = false;
      renderMyDecks();
      show('start');
    } else {
      window.alert('儲存失敗。若你正在使用無痕視窗，瀏覽器會擋下本機儲存，請改用一般視窗。');
    }
  }

  function leaveEditor() {
    if (dirty && !window.confirm('有還沒儲存的變更，確定直接離開？')) return;
    show('start');
  }

  function download(filename, text) {
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      // 延後釋放，避免瀏覽器還沒開始下載就失去來源（會導致檔名掉成 download）
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    } catch (e) {
      window.alert('這個瀏覽器不支援直接下載檔案。');
    }
  }

  /* =========================================================
     遊戲流程
     ========================================================= */
  function startGame(source) {
    var queue, label;

    if (source.kind === 'cloud') {
      var btns = document.querySelectorAll('#lineDeckList [data-act="play"]');
      Array.prototype.forEach.call(btns, function (b) { b.disabled = true; b.textContent = '載入中…'; });
      Cloud.loadWords(source.deckId).then(function (words) {
        renderLineDecks();
        if (!words.length) { window.alert('這個題庫還沒有單字。'); return; }
        beginGame(shuffle(words).slice(0, Math.min(MAX_ROUNDS, words.length)), source.name, source);
      }).catch(function (err) {
        renderLineDecks();
        window.alert('載入題庫失敗：' + err.message);
      });
      return;
    }

    if (source.kind === 'builtin') {
      var meta = DIFFICULTY_META[source.level];
      queue = shuffle(WORD_BANK[source.level]).slice(0, meta.rounds);
      label = meta.label;
    } else {
      var deck = Decks.get(source.id);
      if (!deck || !deck.words.length) {
        window.alert('這個字庫還沒有單字，先加幾個再開始吧。');
        return;
      }
      queue = shuffle(deck.words).slice(0, Math.min(MAX_ROUNDS, deck.words.length));
      label = deck.name;
    }

    beginGame(queue, label, source);
  }

  function beginGame(queue, label, source) {
    lastSource = source;
    state = {
      source: source,
      label: label,
      queue: queue,
      round: 0,
      score: 0,
      perfect: 0,
      results: []
    };

    $('hudDiff').textContent = label;
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

    var letters = Decks.letterCount(item.word);
    var pieces = item.word.split(/[\s\-]+/).filter(Boolean).length;

    $('hudRound').textContent = (state.round + 1) + ' / ' + state.queue.length;
    $('hudScore').textContent = state.score;

    // 沒有中文時改成「聽發音拼單字」——音檔就是唯一的線索，所以自動念一次
    var audioMode = !item.zh;
    $('clueZh').textContent = item.zh || '聽發音，拼出單字';
    $('clueZh').classList.toggle('audio-mode', audioMode);
    $('screen-game').classList.toggle('is-audio', audioMode);

    $('clueIpa').textContent = item.ipa || '';
    $('clueIpa').hidden = !item.ipa;

    $('clueLen').textContent = letters + ' 個字母' + (pieces > 1 ? '・' + pieces + ' 個單字' : '');

    $('sentence').innerHTML = '';
    var noHint = (state.source.kind === 'builtin' && state.source.level === 'hard') || !item.hint;
    $('btnSentence').disabled = noHint;
    $('btnSentence').textContent = noHint
      ? (item.hint ? '📖 困難模式無例句' : '📖 這題沒有例句')
      : '📖 例句';
    $('btnHint').disabled = false;

    setMessage('');
    buildKeyboard();
    renderSlots();
    renderWrong();
    renderHangman();
    renderLives();

    if (audioMode) {
      // 玩家點「開始」已經是使用者互動，之後的自動朗讀瀏覽器才會放行
      setTimeout(function () { speak(item.word); }, 350);
    }
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
      // 空白與連字號不用猜，直接顯示
      if (!isLetter(ch)) {
        var sep = document.createElement('div');
        if (ch === ' ') { sep.className = 'slot-space'; }
        else { sep.className = 'slot-sep'; sep.textContent = ch; }
        box.appendChild(sep);
        return;
      }
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
    Array.prototype.forEach.call(svg.querySelectorAll('.part'), function (p) {
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
    return state.word.split('').every(function (ch) {
      return !isLetter(ch) || state.found[ch];
    });
  }

  /* ---------- 單關結束 ---------- */
  function roundWin() {
    state.locked = true;
    var gained = Math.max(20, 100 - state.wrong * 15 - state.hintUsed * 25);
    var flawless = (state.wrong === 0 && state.hintUsed === 0);
    if (flawless) { gained += 30; state.perfect++; }
    state.score += gained;
    $('hudScore').textContent = state.score;

    pushResult(true);
    sfx.win();
    setMessage((flawless ? '完美！零失誤 ' : '過關！ ') + '+' + gained + ' 分', 'good');
    disableAllKeys();

    setTimeout(function () {
      state.round++;
      if (state.round >= state.queue.length) gameOver(true);
      else loadRound();
    }, 1400);
  }

  function roundLose() {
    state.locked = true;
    renderSlots(true);
    disableAllKeys();
    setMessage('他被吊死了…答案是「' + state.word.toUpperCase() + '」', 'bad');
    pushResult(false);
    setTimeout(function () { gameOver(false); }, 2200);
  }

  function pushResult(ok) {
    state.results.push({
      word: state.word,
      zh: state.queue[state.round].zh,
      ok: ok,
      wrong: state.wrong,
      hint: state.hintUsed
    });
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
      ? '你用「' + state.label + '」救下了所有人。'
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
        '<span class="rw-word">' + esc(r.word.toUpperCase()) + '</span>' +
        '<span class="rw-zh">' + esc(r.zh || '') + '</span>' +
        '<span class="rw-mark">' + (r.ok ? '過關・錯 ' + r.wrong + ' 次' : '失敗') + '</span>';
      list.appendChild(row);
    });

    show('over');
  }

  /* ---------- 提示與例句 ---------- */
  function useHint() {
    if (!state || state.locked) return;
    var remain = state.word.split('').filter(function (ch) {
      return isLetter(ch) && !state.found[ch];
    });
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

  /** 例句裡若沒有 ___，自動把單字本身遮起來 */
  function blankSentence(sentence, word) {
    if (sentence.indexOf('___') !== -1) return sentence;
    var safe = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return sentence.replace(new RegExp(safe, 'ig'), '___');
  }

  function showSentence() {
    if (!state) return;
    var item = state.queue[state.round];
    if (!item.hint) return;
    $('sentence').innerHTML = esc(blankSentence(item.hint, item.word)).replace('___', '<b>___</b>');
  }

  /* =========================================================
     事件綁定
     ========================================================= */
  // 開始畫面
  $('btnNewDeck').addEventListener('click', function () { openEditor(null); });

  // 字庫編輯
  $('btnDeckBack').addEventListener('click', leaveEditor);
  $('btnDeckSave').addEventListener('click', saveDeck);
  $('btnAddWord').addEventListener('click', addOrUpdateWord);
  $('btnCancelEdit').addEventListener('click', resetForm);
  $('deckName').addEventListener('input', function () { dirty = true; });

  $('inWord').addEventListener('input', function () {
    ipaDirty = false;
    setFieldMsg('');
    clearTimeout(ipaTimer);
    ipaTimer = setTimeout(autoFillIpa, 350);
  });
  $('inIpa').addEventListener('input', function () {
    ipaDirty = true;
    setIpaStatus('手動編輯中', '');
  });
  $('btnTrySpeak').addEventListener('click', function () {
    var w = $('inWord').value.trim();
    if (w) speak(w);
  });

  // 表單按 Enter 直接加入
  ['inWord', 'inZh', 'inIpa', 'inHint'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addOrUpdateWord(); }
    });
  });

  $('btnExport').addEventListener('click', function () {
    if (!draft.words.length) { window.alert('字庫是空的，沒有東西可以匯出。'); return; }
    var name = ($('deckName').value.trim() || '未命名字庫');
    var d = new Date();
    var stamp = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    download(name + '-' + stamp + '.json', Decks.exportJson({ name: name, words: draft.words }));
  });

  $('fileRestore').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var res = Decks.importJson(String(reader.result));
      if (res.error) { window.alert(res.error); return; }
      var added = 0, dup = 0;
      res.words.forEach(function (w) {
        var exists = draft.words.some(function (x) { return x.word === w.word; });
        if (exists) { dup++; return; }
        draft.words.push(w);
        added++;
      });
      if (!$('deckName').value.trim() && res.name) {
        $('deckName').value = res.name;
      }
      dirty = true;
      renderDeckWords();
      window.alert('已還原 ' + added + ' 個單字' +
        (dup ? '，' + dup + ' 個重複略過' : '') +
        (res.skipped ? '，' + res.skipped + ' 筆格式不符略過' : '') +
        '。記得按「儲存字庫」。');
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // 遊戲畫面
  $('btnSpeak').addEventListener('click', function () { if (state) speak(state.word); });
  $('btnHint').addEventListener('click', useHint);
  $('btnSentence').addEventListener('click', showSentence);
  $('btnQuit').addEventListener('click', function () {
    if (!state) return;
    if (window.confirm('放棄這一局？目前分數不會保留。')) { renderStart(); show('start'); }
  });

  // 結算畫面
  $('btnRetry').addEventListener('click', function () {
    if (lastSource) startGame(lastSource);
  });
  $('btnHome').addEventListener('click', function () { renderStart(); show('start'); });

  // 實體鍵盤
  document.addEventListener('keydown', function (e) {
    if (!screens.game.classList.contains('is-active')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var ch = e.key.toLowerCase();
    if (ch.length === 1 && ch >= 'a' && ch <= 'z') {
      e.preventDefault();
      guess(ch);
    }
  });

  $('btnLineRefresh').addEventListener('click', function () {
    Cloud.load().then(renderLineDecks);
    renderLineDecks();
  });

  /* ---------- 啟動 ---------- */
  renderStart();
  show('start');
  if (Cloud.enabled()) {
    Cloud.load().then(function () {
      renderLineDecks();
      // 從 LINE 的測驗連結進來：直接開始那一份，不用再點一次
      var deckId = Cloud.takeAutoDeck();
      if (!deckId) return;
      var st = Cloud.state();
      var deck = st.decks.filter(function (d) { return d.id === deckId; })[0];
      if (deck && deck.word_count > 0) {
        startGame({ kind: 'cloud', deckId: deck.id, name: deck.name });
      }
    }).catch(function () { renderLineDecks(); });
  }
})();
