# CLAUDE.md

英文單字拼字遊戲（吊人）＋ LINE 收單字 ＋ 本地 GPU OCR。
**要整合進其他專案看 `HANDOFF.md`；API 介面看 `openapi.yaml`；客戶端在 `client/`。**

## 結構

| 位置 | 內容 | 執行環境 |
| --- | --- | --- |
| 根目錄 | 遊戲前端（純靜態，無框架無建置） | 瀏覽器 |
| `ipa/` | CMU 辭典轉 IPA，117,449 字，按首字母分片 | 瀏覽器按需載入 |
| `server/` | LINE Bot 後端 | Cloudflare Workers + D1 |
| `ocr/` | 圖片辨識 | 使用者本機 GPU（PaddleOCR） |
| `client/` | 給其他專案用的整合客戶端 | 任何 JS 環境 |

## 動手前

```bash
cd server && npm install && npm run db:local   # 建本機 D1、匯入辭典
```

## 改完一定要跑

```bash
cd server
npm test           # 88 項：解析、bot 流程、簽章、佇列
npm run test:e2e   # 38 項：workerd 實際執行 Worker
npm run test:client # 23 項：整合客戶端
cd ../ocr
python3 test_pairing.py && python3 test_dictionary.py && python3 test_service.py   # 60 項
```

前端沒有自動化測試，改了 `game.js` / `cloud.js` 請用 Playwright 實測
（`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`）。

## 這個環境的限制

- **連不到 `api.line.me`**（egress 政策擋掉），LINE 的實際收發無法在此驗證，
  只能用測試替身。`server/test/e2e.mjs` 就是這樣做的。
- **沒有 GPU**，PaddleOCR 的實際辨識率無法驗證。配對與拼字修正的邏輯有完整測試。
- `api.anthropic.com` 連得到，npm 與 PyPI 連得到，其餘一律擋。

## 容易踩的坑

- **D1 的 `.bind()` 回傳新的 statement**，不是就地修改。
  `batch([stmt.bind(a), stmt.bind(b)])` 才正確。測試替身 `test/d1-shim.mjs` 已依此實作。
- **`replyToken` 只能用一次。** 圖片走本地 OCR 時會把 token 存進 jobs 表留給辨識完成後使用，
  所以收到圖片當下是用 push 通知，不要改成 reply。
- **`\b` 以 ASCII 判定**，中文字後面不成立。指令比對要用 `(\s|$)`。
- **單字驗證**：小寫、僅 a–z 與空白連字號撇號、至少兩個字母。
  前端 `decks.js` 與後端 `parse.js` 各有一份，改規則時兩邊都要改。
- **英中分界**用「第一個中文字」而非空白，否則 `ice cream 冰淇淋` 會被切錯。
- 前端 `config.js` 的 `API_BASE` 留空時雲端功能必須靜默停用，不可影響本機字庫。

## 機密

一律用 `wrangler secret put`，不要寫進 `wrangler.toml`。
`server/.dev.vars` 只放本機測試用的假值，已列入 `.gitignore`。

## 語言

程式碼註解、文件、LINE 回覆、介面文字一律使用繁體中文。
