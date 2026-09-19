#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地 OCR 服務 —— 跑在你自己的機器上（RTX 5060）

運作方式：主動向 Worker 領工作，做完回報。
本機不需要固定 IP、不需要對外開放任何連接埠、不需要放行防火牆。

    Worker（公開）          你的機器（本地）
        │                        │
        │◀────── 我有空嗎？ ──────┤  每 N 秒問一次
        ├──── 有，這張圖 ────────▶│
        │                        │  PaddleOCR + 配對
        │◀──── 辨識結果 ──────────┤
        └── 寫入題庫、通知 LINE

用法：
    export WORKER_URL=https://hangman-line-bot.你的名字.workers.dev
    export OCR_KEY=跟 wrangler secret put OCR_WORKER_KEY 設定的同一組
    python3 service.py

先不接 Worker、只測辨識效果：
    python3 service.py --once ./課本照片.jpg
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pairing import pair_ocr_results
from dictionary import load_words, verify_all


# ----------------------------------------------------------------- OCR 引擎

class PaddleBackend(object):
    """PaddleOCR：中英混排辨識品質好，RTX 5060 上一張課本頁面約 1 秒"""

    def __init__(self, use_gpu=True, lang='ch'):
        from paddleocr import PaddleOCR   # 延後載入，沒裝也能跑 --selftest
        # lang='ch' 的模型同時支援中文與英文
        self.ocr = PaddleOCR(use_angle_cls=True, lang=lang, use_gpu=use_gpu, show_log=False)

    def read(self, image_path):
        result = self.ocr.ocr(image_path, cls=True)
        items = []
        # PaddleOCR 依版本可能多包一層
        pages = result if result and isinstance(result[0], list) else [result]
        for page in pages:
            for line in (page or []):
                if not line:
                    continue
                quad, (text, conf) = line[0], line[1]
                if conf is not None and conf < 0.5:
                    continue
                xs = [p[0] for p in quad]
                ys = [p[1] for p in quad]
                items.append({
                    'text': text,
                    'box': [min(xs), min(ys), max(xs), max(ys)],
                    'conf': conf
                })
        return items


class StubBackend(object):
    """測試用：回傳預先準備好的文字框，不需要 GPU 也不需要安裝 PaddleOCR"""

    def __init__(self, items):
        self.items = items
        self.calls = []

    def read(self, image_path):
        self.calls.append(image_path)
        return list(self.items)


# ----------------------------------------------------------------- Worker 通訊

class Worker(object):
    def __init__(self, base_url, key, timeout=60):
        self.base = base_url.rstrip('/')
        self.key = key
        self.timeout = timeout

    def _request(self, path, method='GET', payload=None, raw=False):
        url = self.base + path
        data = json.dumps(payload).encode('utf-8') if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header('x-ocr-key', self.key)
        if data:
            req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=self.timeout) as res:
            body = res.read()
        return body if raw else json.loads(body.decode('utf-8'))

    def claim(self):
        return self._request('/ocr/claim', method='POST', payload={}).get('job')

    def download(self, url, dest):
        req = urllib.request.Request(url)
        req.add_header('x-ocr-key', self.key)
        with urllib.request.urlopen(req, timeout=self.timeout) as res:
            data = res.read()
        with open(dest, 'wb') as f:
            f.write(data)
        return dest

    def report(self, job_id, words=None, error=None, fixes=None, suspect=None):
        payload = {'jobId': job_id}
        if error:
            payload['error'] = str(error)[:300]
        else:
            payload['words'] = words or []
            payload['fixes'] = fixes or []
            payload['suspect'] = suspect or []
        return self._request('/ocr/result', method='POST', payload=payload)


# ----------------------------------------------------------------- 主流程

def process_one(worker, backend, tmp_dir='.', words=None):
    """領一份工作做完。有做事回傳 True，沒工作回傳 False。"""
    job = worker.claim()
    if not job:
        return False

    job_id = job['id']
    deck = job.get('deckName', '')
    print(u'[job %s] 開始辨識（題庫：%s）' % (job_id, deck))

    tmp_path = os.path.join(tmp_dir, 'ocr_job_%s.img' % job_id)
    try:
        worker.download(job['imageUrl'], tmp_path)
        items = backend.read(tmp_path)
        entries = pair_ocr_results(items)

        # 用辭典檢查拼字：英文拼錯的話那題就無解了，所以這一步很關鍵
        fixes, suspect = [], []
        if words is not None:
            entries, fixes, suspect = verify_all(entries, words)

        print(u'[job %s] 讀到 %d 個文字框 → 配出 %d 個單字' % (job_id, len(items), len(entries)))
        for f in fixes:
            print(u'    拼字修正 %s → %s' % (f['from'], f['to']))
        if suspect:
            print(u'    可疑（辭典查無）：%s' % u'、'.join(suspect))
        for w in entries[:10]:
            print(u'    %-22s %s' % (w['word'], w['zh']))

        worker.report(job_id, words=entries, fixes=fixes, suspect=suspect)
    except Exception as exc:
        print(u'[job %s] 失敗：%s' % (job_id, exc))
        try:
            worker.report(job_id, error=str(exc))
        except Exception as report_err:
            print(u'[job %s] 連回報失敗都失敗了：%s' % (job_id, report_err))
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
    return True


def loop(worker, backend, idle_interval=3.0, busy_interval=0.2, words=None):
    print(u'開始輪詢 %s' % worker.base)
    while True:
        try:
            did = process_one(worker, backend, words=words)
        except urllib.error.HTTPError as e:
            print(u'Worker 回應 %s —— 檢查 OCR_KEY 是否正確' % e.code)
            did = False
            time.sleep(10)
        except urllib.error.URLError as e:
            print(u'連不到 Worker：%s' % e.reason)
            did = False
            time.sleep(10)
        time.sleep(busy_interval if did else idle_interval)


def main():
    ap = argparse.ArgumentParser(description='本地 OCR 服務')
    ap.add_argument('--once', metavar='IMAGE', help='只辨識一張本機圖片並印出結果，不連 Worker')
    ap.add_argument('--cpu', action='store_true', help='不使用 GPU')
    ap.add_argument('--lang', default='ch', help="PaddleOCR 語言模型，預設 ch（中英混排）")
    ap.add_argument('--interval', type=float, default=3.0, help='沒工作時的輪詢間隔（秒）')
    args = ap.parse_args()

    dictionary = load_words()

    if args.once:
        backend = PaddleBackend(use_gpu=not args.cpu, lang=args.lang)
        items = backend.read(args.once)
        entries = pair_ocr_results(items)
        entries, fixes, suspect = verify_all(entries, dictionary)
        print(u'\n讀到 %d 個文字框，配出 %d 個單字：\n' % (len(items), len(entries)))
        for w in entries:
            print(u'  %-24s %s' % (w['word'], w['zh']))
        if fixes:
            print(u'\n拼字修正 %d 處：' % len(fixes))
            for f in fixes:
                print(u'  %s → %s' % (f['from'], f['to']))
        if suspect:
            print(u'\n辭典查無、請檢查：%s' % u'、'.join(suspect))
        return

    base = os.environ.get('WORKER_URL')
    key = os.environ.get('OCR_KEY')
    if not base or not key:
        print(u'請先設定環境變數 WORKER_URL 與 OCR_KEY')
        sys.exit(1)

    print(u'辭典載入 %d 字' % len(dictionary))
    backend = PaddleBackend(use_gpu=not args.cpu, lang=args.lang)
    loop(Worker(base, key), backend, idle_interval=args.interval, words=dictionary)


if __name__ == '__main__':
    main()
