# -*- coding: utf-8 -*-
"""輪詢流程測試：用假的 Worker 驗證領工作、下載、回報、錯誤處理"""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, '/home/user/AAA/ocr')
from service import Worker, StubBackend, process_one

passed = failed = 0
def check(name, got, want):
    global passed, failed
    if got == want:
        passed += 1; print(u'  ✓ ' + name)
    else:
        failed += 1; print(u'  ✗ %s\n      得到: %r\n      預期: %r' % (name, got, want))

# ---- 假的 Worker ----
STATE = {'queue': [], 'reports': [], 'image_hits': 0, 'auth_fail': 0}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _send(self, code, body, ctype='application/json'):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _auth(self):
        if self.headers.get('x-ocr-key') != 'secret123':
            STATE['auth_fail'] += 1
            self._send(401, {'error': 'unauthorized'})
            return False
        return True

    def do_POST(self):
        if not self._auth(): return
        n = int(self.headers.get('Content-Length', 0))
        payload = json.loads(self.rfile.read(n) or b'{}')
        if self.path == '/ocr/claim':
            job = STATE['queue'].pop(0) if STATE['queue'] else None
            self._send(200, {'job': job})
        elif self.path == '/ocr/result':
            STATE['reports'].append(payload)
            self._send(200, {'ok': True})
        else:
            self._send(404, {})

    def do_GET(self):
        if not self._auth(): return
        if self.path.startswith('/ocr/image/'):
            STATE['image_hits'] += 1
            self._send(200, b'\xff\xd8\xff\xe0FAKEJPEG', 'image/jpeg')
        else:
            self._send(404, {})

srv = HTTPServer(('127.0.0.1', 8912), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:8912'

BOXES = [
    {'text': u'apple',  'box': [80, 100, 170, 124]},
    {'text': u'蘋果',   'box': [320, 100, 384, 122]},
    {'text': u'banana', 'box': [80, 150, 190, 174]},
    {'text': u'香蕉',   'box': [320, 150, 384, 172]},
]

print(u'\n[沒有工作時]')
w = Worker(BASE, 'secret123')
backend = StubBackend(BOXES)
check(u'領不到工作回傳 False', process_one(w, backend, '/tmp'), False)
check(u'沒有呼叫 OCR', len(backend.calls), 0)

print(u'\n[正常處理一份工作]')
STATE['queue'].append({'id': 1, 'deckName': u'課本第一課', 'imageUrl': BASE + '/ocr/image/1'})
check(u'有處理回傳 True', process_one(w, backend, '/tmp'), True)
check(u'有下載圖片', STATE['image_hits'], 1)
check(u'有呼叫 OCR', len(backend.calls), 1)
check(u'回報內容正確', STATE['reports'][-1],
      {'jobId': 1, 'words': [{'word': 'apple', 'zh': u'蘋果'}, {'word': 'banana', 'zh': u'香蕉'}]})
check(u'暫存檔已刪除', os.path.exists('/tmp/ocr_job_1.img'), False)

print(u'\n[OCR 當掉時]')
class Boom(object):
    def read(self, p): raise RuntimeError(u'CUDA out of memory')
STATE['queue'].append({'id': 2, 'deckName': u'x', 'imageUrl': BASE + '/ocr/image/2'})
check(u'仍回傳 True（有處理過）', process_one(w, Boom(), '/tmp'), True)
check(u'錯誤有回報給 Worker', STATE['reports'][-1]['jobId'], 2)
check(u'錯誤訊息有帶上', 'CUDA out of memory' in STATE['reports'][-1]['error'], True)
check(u'失敗後暫存檔也清掉', os.path.exists('/tmp/ocr_job_2.img'), False)

print(u'\n[讀不到任何字]')
STATE['queue'].append({'id': 3, 'deckName': u'x', 'imageUrl': BASE + '/ocr/image/3'})
process_one(w, StubBackend([]), '/tmp')
check(u'回報空清單而非錯誤', STATE['reports'][-1], {'jobId': 3, 'words': []})

print(u'\n[金鑰錯誤]')
bad = Worker(BASE, 'wrong_key')
err = None
try:
    bad.claim()
except Exception as e:
    err = getattr(e, 'code', None)
check(u'被擋下並回 401', err, 401)
check(u'伺服器有記錄到驗證失敗', STATE['auth_fail'] > 0, True)

srv.shutdown()
print(u'\n總計：%d 通過，%d 失敗' % (passed, failed))
sys.exit(1 if failed else 0)
