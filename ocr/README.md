# 本地 OCR 服務

跑在你自己的機器上（RTX 5060），負責把課本照片裡的文字讀出來、
並配對成「英文單字 ↔ 中文意思」。**圖片辨識不呼叫任何雲端 AI，不產生費用。**

## 為什麼不用打洞或固定 IP

本機是**主動向 Worker 領工作**，不是等別人連進來：

```
     Worker（公開、永遠在線）        你的機器（本地）
              │                          │
              │◀───── 有工作嗎？ ─────────┤   每 3 秒問一次
              ├───── 有，這張圖 ─────────▶│
              │                          │   PaddleOCR → 配對
              │◀───── 辨識結果 ───────────┤
              └── 寫入題庫 → 通知 LINE
```

所以你**不需要**固定 IP、不需要開放連接埠、不需要設定防火牆或內網穿透。
機器關機時圖片會留在佇列裡，開機後自動補做。

## 安裝

```bash
# PaddlePaddle GPU 版（對應你的 CUDA 版本，詳見 paddlepaddle.org.cn）
pip install paddlepaddle-gpu
pip install paddleocr

# 沒有 GPU 也能跑，只是慢一些
# pip install paddlepaddle paddleocr
```

第一次執行會自動下載模型（約 200MB）。

## 先確認辨識效果

不用接 Worker，直接對一張照片試：

```bash
python3 service.py --once ./課本第一課.jpg
```

會印出讀到幾個文字框、配出哪些單字。效果不好的話可以調整拍攝方式
（拍正、光線均勻、不要有大角度傾斜），或加 `--lang en` 試純英文模型。

## 正式運行

```bash
export WORKER_URL=https://hangman-line-bot.你的名字.workers.dev
export OCR_KEY=跟 wrangler secret put OCR_WORKER_KEY 設的同一組
python3 service.py
```

保持這個程式開著就行。要它開機自動啟動，可以包成 systemd service 或
Windows 工作排程器的登入啟動項。

## 配對演算法

OCR 吐出來的是一堆**帶座標的文字框**，順序不保證正確，課本又常是雙欄排版，
所以「把字讀出來」之後還要決定**哪個英文對應哪個中文**。`pairing.py` 做這件事：

1. 依垂直位置分行（用字高比例判斷，英文大字、中文小字也算同一行）
2. 行內由左到右掃，看到英文開一筆，後面的中文都算它的，直到下一個英文
   —— 雙欄 `en zh en zh` 自然就切成兩筆
3. OCR 把「apple 蘋果」讀成同一框時，用第一個中文字當分界
4. 中文寫在英文**下方**的版面，會跨行用水平位置配對
5. 濾掉編號、頁碼、`Lesson 3`、詞性標記 `n.` `adj.`、行內音標

測試涵蓋以上每一種版面：

```bash
python3 test_pairing.py     # 14 項：各種排版的配對正確性
python3 test_service.py     # 14 項：輪詢、下載、回報、錯誤處理、金鑰驗證
```

`test_service.py` 用假的 Worker（本機 HTTP 伺服器）跑完整流程，不需要 GPU。

## 沒有本地機器時

把 Worker 的 `OCR_MODE` 改成 `cloud`，圖片就改由 Claude 辨識
（每張約 US$0.02）。兩種模式的後續流程完全一樣。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `service.py` | 輪詢、下載圖片、呼叫 OCR、回報結果 |
| `pairing.py` | 文字框 → 英中配對（純函式，無外部相依） |
| `test_pairing.py` | 配對演算法測試 |
| `test_service.py` | 輪詢流程測試 |
