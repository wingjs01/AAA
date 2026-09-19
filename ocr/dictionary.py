# -*- coding: utf-8 -*-
"""
用 CMU 辭典驗證並修正 OCR 的錯字。

只要能發音就好 —— 但前提是「字要拼對」，因為英文拼字就是遊戲的答案。
OCR 的錯誤多半是形近字元（rn→m、l→1、0→o、cl→d），
這些用一本 11 萬字的辭典幾乎都救得回來。
"""
import json
import os
import re

ALPHABET = 'abcdefghijklmnopqrstuvwxyz'

# OCR 最常見的形近誤判：數字與字母互換
DIGIT_FIXES = [
    ('0', 'o'), ('1', 'l'), ('1', 'i'), ('5', 's'),
    ('8', 'b'), ('6', 'b'), ('9', 'g'), ('2', 'z'), ('3', 'e'),
]


def load_words(ipa_dir=None):
    """從 ipa/*.js 讀出所有收錄的單字，回傳 set"""
    if ipa_dir is None:
        ipa_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'ipa')

    words = set()
    for c in ALPHABET:
        path = os.path.join(ipa_dir, '%s.js' % c)
        if not os.path.exists(path):
            continue
        src = open(path, encoding='utf-8').read()
        # 檔案格式：IPA_DATA["a"]="word ipa\nword ipa";
        # 第一個引號屬於索引鍵，要取 ]= 之後的那個
        start = src.index(']=') + 2
        end = src.rindex('"')
        # 這裡的跳脫（\n \" \\）與 JSON 相容，直接交給 json 解
        blob = json.loads(src[start:end + 1])
        for line in blob.split('\n'):
            sp = line.find(' ')
            if sp > 0:
                words.add(line[:sp])
    return words


# 多字元的形近誤判。OCR 把 m 讀成 rn、d 讀成 cl 都極常見，
# 這類的編輯距離是 2，單靠 edits1 補不回來。
SHAPE_FIXES = [
    ('rn', 'm'), ('m', 'rn'), ('cl', 'd'), ('d', 'cl'),
    ('vv', 'w'), ('w', 'vv'), ('li', 'h'), ('lj', 'y'),
    ('nn', 'm'), ('ni', 'm'), ('ri', 'n'), ('iii', 'm'),
]


def _shape_variants(word, limit=32):
    out = {word}
    for pat, rep in SHAPE_FIXES:
        if pat not in word:
            continue
        more = set()
        for w in out:
            more.add(w.replace(pat, rep))
        out |= more
        if len(out) >= limit:
            break
    return out


def _edits1(word):
    """所有編輯距離 1 的候選：刪、換位、替換、插入"""
    splits = [(word[:i], word[i:]) for i in range(len(word) + 1)]
    deletes = [a + b[1:] for a, b in splits if b]
    transposes = [a + b[1] + b[0] + b[2:] for a, b in splits if len(b) > 1]
    replaces = [a + c + b[1:] for a, b in splits if b for c in ALPHABET]
    inserts = [a + c + b for a, b in splits for c in ALPHABET]
    return set(deletes + transposes + replaces + inserts)


def _digit_variants(word):
    """把數字換回形近字母，產生候選"""
    out = {word}
    for digit, letter in DIGIT_FIXES:
        if digit in word:
            more = set()
            for w in out:
                more.add(w.replace(digit, letter))
            out |= more
    return out


def correct_word(word, words):
    """
    回傳 (修正後的字, 狀態)
    狀態：ok（本來就對）／fixed（修好了）／unsure（有多個候選）／unknown（查不到）
    """
    w = word.lower().strip()
    if not w:
        return word, 'unknown'

    # 單字母的英文只有 a 和 I，去「修正」它只會改壞
    # （辭典本身只收兩個字母以上，所以要特別放行）
    if len(w) == 1:
        return w, 'ok'

    if w in words:
        return w, 'ok'

    # 先試形近替換（數字↔字母、rn↔m 這類），這些最常見也最有把握
    variants = set()
    for d in _digit_variants(w):
        variants |= _shape_variants(d)

    direct = sorted(v for v in variants if v != w and v in words)
    if len(direct) == 1:
        return direct[0], 'fixed'
    if len(direct) > 1:
        same_len = [h for h in direct if len(h) == len(w)]
        return (same_len[0], 'fixed') if len(same_len) == 1 else (direct[0], 'fixed')

    # 再試編輯距離 1
    pool = set()
    for base in variants:
        pool |= _edits1(base)
    hits = sorted(pool & words)

    if len(hits) == 1:
        return hits[0], 'fixed'
    if len(hits) > 1:
        # 多個候選時，優先選長度相同的（替換比增刪可信）
        same_len = [h for h in hits if len(h) == len(w)]
        if len(same_len) == 1:
            return same_len[0], 'fixed'
        return w, 'unsure'

    return w, 'unknown'


def correct_entry(word, words):
    """片語逐字修正；任何一段修過就算 fixed"""
    parts = re.split(r'([\s\-]+)', word.lower().strip())
    out = []
    status = 'ok'
    for part in parts:
        if not part or re.match(r'^[\s\-]+$', part):
            out.append(part)
            continue
        fixed, st = correct_word(part, words)
        out.append(fixed)
        if st == 'fixed' and status == 'ok':
            status = 'fixed'
        elif st in ('unsure', 'unknown'):
            status = st
    return ''.join(out), status


def verify_all(entries, words):
    """
    對整批辨識結果做拼字檢查。
    回傳 (可用的單字, 修正紀錄, 可疑的單字)
    可疑的字仍然保留 —— 語音合成念得出來，只是提醒使用者檢查。
    """
    out, fixes, suspect = [], [], []
    for e in entries:
        fixed, status = correct_entry(e['word'], words)
        entry = {'word': fixed, 'zh': e.get('zh', '')}
        if status == 'fixed':
            fixes.append({'from': e['word'], 'to': fixed})
        elif status in ('unsure', 'unknown'):
            suspect.append(fixed)
        out.append(entry)
    return out, fixes, suspect
