# -*- coding: utf-8 -*-
"""辭典拼字修正測試"""
import sys, time
sys.path.insert(0, '/home/user/AAA/ocr')
from dictionary import load_words, correct_entry, verify_all

passed = failed = 0
def check(name, got, want):
    global passed, failed
    if got == want:
        passed += 1; print(u'  ✓ ' + name)
    else:
        failed += 1; print(u'  ✗ %s\n      得到: %r\n      預期: %r' % (name, got, want))

W = load_words()
print(u'辭典載入 %d 字' % len(W))

print(u'\n[正確的字絕對不能被改壞]')
REAL = ['apple','banana','read','bread','cat','hat','mountain','computer','the','a',
        'was','saw','form','from','quiet','quite','desert','dessert','lose','loose',
        'affect','effect','then','than','trail','trial','angel','angle','butterfly',
        'knowledge','hospital','telephone','vegetable','wonderful','dangerous','ice','cream']
bad = [(w, correct_entry(w, W)[0]) for w in REAL if correct_entry(w, W)[0] != w]
check(u'%d 個常見正確字原樣保留' % len(REAL), bad, [])
check(u'狀態都是 ok', sorted({correct_entry(w, W)[1] for w in REAL}), ['ok'])

print(u'\n[數字誤判]')
for bad_w, good in [('app1e','apple'), ('0range','orange'), ('hospita1','hospital'),
                    ('dangerou5','dangerous'), ('b00k','book')]:
    check(u'%s → %s' % (bad_w, good), correct_entry(bad_w, W)[0], good)

print(u'\n[形近字元]')
for bad_w, good in [('rnountain','mountain'), ('cornputer','computer'), ('crearn','cream'),
                    ('buttertly','butterfly'), ('knowledqe','knowledge'),
                    ('vegetahle','vegetable'), ('teIephone','telephone')]:
    check(u'%s → %s' % (bad_w, good), correct_entry(bad_w, W)[0], good)

print(u'\n[片語逐字修正]')
check(u'ice crearn → ice cream', correct_entry('ice crearn', W)[0], 'ice cream')
check(u'look forvvard to → look forward to', correct_entry('look forvvard to', W)[0], 'look forward to')
check(u'連字號保留', correct_entry('well-knovvn', W)[0], 'well-known')

print(u'\n[真的不是單字]')
for junk in ['zzzqqq', 'xqzkpr', 'qqqq']:
    check(u'%s 標記為可疑' % junk, correct_entry(junk, W)[1] in ('unknown', 'unsure'), True)

print(u'\n[整批處理]')
entries = [
    {'word': 'butterfly', 'zh': u'蝴蝶'},
    {'word': 'rnountain', 'zh': ''},
    {'word': 'app1e', 'zh': u'蘋果'},
    {'word': 'zzzqqq', 'zh': ''},
]
out, fixes, suspect = verify_all(entries, W)
check(u'輸出字數不變', len(out), 4)
check(u'修正後的拼字', [e['word'] for e in out], ['butterfly', 'mountain', 'apple', 'zzzqqq'])
check(u'中文原樣保留', [e['zh'] for e in out], [u'蝴蝶', '', u'蘋果', ''])
check(u'修正紀錄', fixes, [{'from': 'rnountain', 'to': 'mountain'}, {'from': 'app1e', 'to': 'apple'}])
check(u'可疑字被列出', suspect, ['zzzqqq'])
check(u'可疑字仍然保留在結果裡（語音合成念得出來）', 'zzzqqq' in [e['word'] for e in out], True)

print(u'\n[效能]')
t = time.time()
for _ in range(20):
    verify_all(entries, W)
elapsed = time.time() - t
check(u'80 個字 %.3f 秒（<1 秒）' % elapsed, elapsed < 1.0, True)

print(u'\n總計：%d 通過，%d 失敗' % (passed, failed))
sys.exit(1 if failed else 0)
