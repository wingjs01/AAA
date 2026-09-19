"""
把 OCR 的文字框配對成「英文單字 ↔ 中文意思」。

OCR（PaddleOCR 等）回傳的是一堆帶座標的文字框，順序不一定可靠，
課本又常是雙欄排版。這裡用座標把它們排回行、再在行內左到右配對。

輸入：[{"text": str, "box": [x0, y0, x1, y1]}, ...]
輸出：[{"word": str, "zh": str}, ...]
"""
import re

CJK = re.compile(r'[㐀-䶿一-鿿豈-﫿]')
HAS_LATIN = re.compile(r'[A-Za-z]')

# 課本上常見、但不是單字的東西
NOISE_PATTERNS = [
    re.compile(r'^\s*\d+\s*[.、)）]?\s*$'),            # 純編號：1. 2) 3、
    re.compile(r'^\s*(lesson|unit|chapter|page|p)\s*\.?\s*\d*\s*$', re.I),
    re.compile(r'^\s*(n|v|adj|adv|prep|conj|pron|art|aux)\s*\.\s*$', re.I),  # 詞性
    re.compile(r'^\s*[\[\]()（）/|．·,，。:：;；~\-—_=+*#@!?？！"\'`]+\s*$'),   # 純符號
    re.compile(r'^\s*[/\[].*[/\]]\s*$'),                # 音標 /ˈæp.əl/ 或 [æpl]
]

# 行首的編號與詞性標記，要從文字裡剝掉
LEADING_NUM = re.compile(r'^\s*\d+\s*[.、)）]\s*')
POS_TAG = re.compile(r'\b(n|v|adj|adv|prep|conj|pron|art|aux|vi|vt)\s*\.\s*', re.I)
IPA_INLINE = re.compile(r'[/\[][^/\]]{2,}[/\]]')


def is_noise(text):
    t = text.strip()
    if not t:
        return True
    return any(p.match(t) for p in NOISE_PATTERNS)


def clean_text(text):
    """剝掉編號、詞性標記、行內音標"""
    t = LEADING_NUM.sub('', text)
    t = IPA_INLINE.sub(' ', t)
    t = POS_TAG.sub(' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def kind_of(text):
    """這個框是英文、中文、還是兩者都有"""
    has_cjk = bool(CJK.search(text))
    has_lat = bool(HAS_LATIN.search(text))
    if has_cjk and has_lat:
        return 'mixed'
    if has_cjk:
        return 'zh'
    if has_lat:
        return 'en'
    return 'other'


def split_mixed(text):
    """一個框裡同時有英文和中文時，用第一個中文字當分界"""
    m = CJK.search(text)
    if not m:
        return text.strip(), ''
    return text[:m.start()].strip(), text[m.start():].strip()


def _cy(box):
    return (box[1] + box[3]) / 2.0


def _height(box):
    return max(1.0, box[3] - box[1])


def group_rows(items, tolerance=0.6):
    """
    依垂直位置把文字框分行。
    同一行的判準是「中心點的垂直距離小於字高的一定比例」，
    這樣字級不同（英文大、中文小）也不會被拆開。
    """
    if not items:
        return []

    ordered = sorted(items, key=lambda it: _cy(it['box']))
    rows = [[ordered[0]]]

    for it in ordered[1:]:
        row = rows[-1]
        ref_cy = sum(_cy(x['box']) for x in row) / len(row)
        ref_h = sum(_height(x['box']) for x in row) / len(row)
        if abs(_cy(it['box']) - ref_cy) <= ref_h * tolerance:
            row.append(it)
        else:
            rows.append([it])

    for row in rows:
        row.sort(key=lambda it: it['box'][0])
    return rows


def pair_row(row):
    """
    行內由左到右配對：看到英文就開一筆，後面接到的中文都算它的，
    直到遇見下一個英文。雙欄排版（en zh en zh）自然就被切成兩筆。
    """
    pairs = []
    current = None

    for it in row:
        text = clean_text(it['text'])
        if not text or is_noise(text):
            continue

        kind = kind_of(text)

        if kind == 'mixed':
            en, zh = split_mixed(text)
            if current:
                pairs.append(current)
            current = {'word': en, 'zh': zh, 'x': it['box'][0]} if en else None
            if not en and zh and pairs:
                pairs[-1]['zh'] = (pairs[-1]['zh'] + ' ' + zh).strip()
            continue

        if kind == 'en':
            if current:
                pairs.append(current)
            current = {'word': text, 'zh': '', 'x': it['box'][0]}
        elif kind == 'zh':
            if current:
                current['zh'] = (current['zh'] + ' ' + text).strip()
            elif pairs:
                pairs[-1]['zh'] = (pairs[-1]['zh'] + ' ' + text).strip()

    if current:
        pairs.append(current)
    return pairs


def merge_vertical(rows_pairs, rows):
    """
    有些版面是中文寫在英文「下方」而不是右邊。
    如果某一行只有英文沒中文，下一行只有中文沒英文，且水平位置對得上，
    就把它們接起來。
    """
    out = []
    i = 0
    while i < len(rows_pairs):
        cur = rows_pairs[i]
        nxt = rows_pairs[i + 1] if i + 1 < len(rows_pairs) else None

        cur_bare = [p for p in cur if not p['zh']]
        # 下一行必須「完全沒有英文」才視為補充說明
        next_all_zh = (
            nxt is not None
            and len(nxt) == 0
            and i + 1 < len(rows)
            and all(kind_of(clean_text(it['text'])) in ('zh', 'other') for it in rows[i + 1])
            and any(kind_of(clean_text(it['text'])) == 'zh' for it in rows[i + 1])
        )

        if cur_bare and next_all_zh:
            zh_items = [it for it in rows[i + 1]
                        if kind_of(clean_text(it['text'])) == 'zh' and not is_noise(clean_text(it['text']))]
            for p in cur_bare:
                # 找水平位置最接近的中文
                best, best_d = None, None
                for z in zh_items:
                    d = abs(z['box'][0] - p['x'])
                    if best_d is None or d < best_d:
                        best, best_d = z, d
                if best is not None:
                    p['zh'] = clean_text(best['text'])
                    zh_items.remove(best)
            out.extend(cur)
            i += 2
            continue

        out.extend(cur)
        i += 1
    return out


def pair_ocr_results(items):
    """主入口：OCR 文字框 → 單字配對"""
    usable = [it for it in items
              if it.get('text') and it.get('box') and not is_noise(it['text'])]
    rows = group_rows(usable)
    rows_pairs = [pair_row(r) for r in rows]
    merged = merge_vertical(rows_pairs, rows)

    out = []
    seen = set()
    for p in merged:
        word = re.sub(r'\s+', ' ', p['word']).strip(' .,:;-–—')
        if not word:
            continue
        key = word.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({'word': word, 'zh': p['zh'].strip()})
    return out
