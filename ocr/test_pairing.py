# -*- coding: utf-8 -*-
"""配對演算法測試：用各種課本排版的座標資料驗證"""
import random
import sys
sys.path.insert(0, '/home/user/AAA/ocr')
from pairing import pair_ocr_results

passed = failed = 0

def check(name, got, want):
    global passed, failed
    if got == want:
        passed += 1
        print(u'  ✓ ' + name)
    else:
        failed += 1
        print(u'  ✗ ' + name)
        print(u'      得到: %r' % (got,))
        print(u'      預期: %r' % (want,))

def box(text, x0, y0, x1, y1):
    return {'text': text, 'box': [x0, y0, x1, y1]}


print(u'\n[單欄：英文左、中文右]')
check(u'含編號的標準單字表',
      pair_ocr_results([
          box(u'1.', 40, 100, 62, 122),
          box(u'apple', 80, 98, 170, 124),
          box(u'蘋果', 320, 100, 384, 122),
          box(u'2.', 40, 150, 62, 172),
          box(u'banana', 80, 148, 190, 174),
          box(u'香蕉', 320, 150, 384, 172),
      ]),
      [{'word': 'apple', 'zh': u'蘋果'}, {'word': 'banana', 'zh': u'香蕉'}])

print(u'\n[雙欄排版]')
check(u'一行兩組 en-zh 正確切開',
      pair_ocr_results([
          box(u'apple', 80, 100, 170, 124),
          box(u'蘋果', 210, 102, 274, 122),
          box(u'banana', 420, 100, 530, 124),
          box(u'香蕉', 570, 102, 634, 122),
      ]),
      [{'word': 'apple', 'zh': u'蘋果'}, {'word': 'banana', 'zh': u'香蕉'}])

print(u'\n[OCR 把英中讀成同一個框]')
check(u'用第一個中文字分界',
      pair_ocr_results([box(u'apple 蘋果', 80, 100, 384, 124)]),
      [{'word': 'apple', 'zh': u'蘋果'}])
check(u'片語合併框也正確',
      pair_ocr_results([box(u'look forward to 期待', 80, 100, 500, 124)]),
      [{'word': 'look forward to', 'zh': u'期待'}])

print(u'\n[中文在英文下方]')
check(u'跨行配對',
      pair_ocr_results([
          box(u'butterfly', 80, 100, 210, 126),
          box(u'蝴蝶', 84, 140, 148, 162),
          box(u'knowledge', 80, 200, 220, 226),
          box(u'知識', 84, 240, 148, 262),
      ]),
      [{'word': 'butterfly', 'zh': u'蝴蝶'}, {'word': 'knowledge', 'zh': u'知識'}])

print(u'\n[雜訊過濾]')
check(u'課次、頁碼、詞性、音標都被濾掉',
      pair_ocr_results([
          box(u'Lesson 3', 300, 40, 420, 66),
          box(u'apple', 80, 100, 170, 124),
          box(u'/ˈæp.əl/', 200, 100, 300, 124),
          box(u'n.', 320, 100, 348, 124),
          box(u'蘋果', 380, 100, 444, 122),
          box(u'12', 500, 700, 524, 722),
      ]),
      [{'word': 'apple', 'zh': u'蘋果'}])
check(u'行內詞性與音標被剝除',
      pair_ocr_results([box(u'3. apple n. /ˈæp.əl/ 蘋果', 80, 100, 600, 124)]),
      [{'word': 'apple', 'zh': u'蘋果'}])

print(u'\n[缺中文]')
check(u'只有英文也收，中文留空',
      pair_ocr_results([
          box(u'apple', 80, 100, 170, 124),
          box(u'banana', 80, 150, 190, 174),
          box(u'香蕉', 320, 150, 384, 172),
      ]),
      [{'word': 'apple', 'zh': ''}, {'word': 'banana', 'zh': u'香蕉'}])

print(u'\n[中文一格被拆成兩段]')
check(u'同一個英文的多段中文會合併',
      pair_ocr_results([
          box(u'run', 80, 100, 140, 124),
          box(u'跑步；', 320, 100, 390, 122),
          box(u'奔跑', 400, 100, 464, 122),
      ]),
      [{'word': 'run', 'zh': u'跑步； 奔跑'}])

print(u'\n[字級不同]')
check(u'英文大字、中文小字仍算同一行',
      pair_ocr_results([
          box(u'elephant', 80, 92, 230, 132),
          box(u'大象', 340, 104, 392, 124),
      ]),
      [{'word': 'elephant', 'zh': u'大象'}])

print(u'\n[OCR 輸出順序不可靠]')
items = [
    box(u'apple', 80, 100, 170, 124), box(u'蘋果', 320, 100, 384, 122),
    box(u'banana', 80, 150, 190, 174), box(u'香蕉', 320, 150, 384, 172),
    box(u'cherry', 80, 200, 180, 224), box(u'櫻桃', 320, 200, 384, 222),
]
want = [{'word': 'apple', 'zh': u'蘋果'}, {'word': 'banana', 'zh': u'香蕉'}, {'word': 'cherry', 'zh': u'櫻桃'}]
ok = True
for seed in range(30):
    shuffled = items[:]
    random.Random(seed).shuffle(shuffled)
    if pair_ocr_results(shuffled) != want:
        ok = False
        break
check(u'打亂 30 種順序結果都一樣', ok, True)

print(u'\n[重複與邊界]')
check(u'同一頁重複的字只留一筆',
      pair_ocr_results([
          box(u'apple', 80, 100, 170, 124), box(u'蘋果', 320, 100, 384, 122),
          box(u'Apple', 80, 150, 170, 174), box(u'蘋果', 320, 150, 384, 172),
      ]),
      [{'word': 'apple', 'zh': u'蘋果'}])
check(u'空輸入', pair_ocr_results([]), [])
check(u'全是雜訊',
      pair_ocr_results([box(u'Lesson 1', 80, 40, 200, 66), box(u'25', 500, 700, 524, 722)]), [])

print(u'\n總計：%d 通過，%d 失敗' % (passed, failed))
sys.exit(1 if failed else 0)
