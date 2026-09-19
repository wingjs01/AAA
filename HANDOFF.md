# 交接文件：單字吊人（Hangman Vocabulary）

**給接手的開發者或 AI agent。** 這份文件的目的是讓你不必讀完整個專案，
就能把這套單字系統整合進既有的 LINE Bot 或 SaaS 專案。

- Repo：`https://github.com/wingjs01/AAA`
- 分支：`main`（與 `claude/english-vocabulary-game-dl5yjq` 內容相同）
- 授權與部署：使用者自行持有 Cloudflare 與 LINE 帳號

> ⚠️ 這個 repo 目前是 **public**。要改成 private：
> repo → Settings → General → Danger Zone → Change repository visibility。

---

## 1. 這是什麼

英文單字拼字遊戲（吊人），加上一條「LINE 收單字 → 存題庫 → 網頁作答」的流程。

```
LINE 使用者 ──打字/拍照──▶ LINE 平台 ──webhook──▶ Cloudflare Worker ──▶ D1
                                                        │
                                              本地 GPU ─┘（圖片 OCR，主動輪詢）
                                                        │
                                          回覆「已收進課本第一課」+ 測驗連結
                                                        ▼
                                              遊戲網頁（純靜態，在網頁上作答）
```

設計原則（沿用自使用者既有系統的想法）：

- **LINE 只負責三件事**：帳號識別、文字／圖片上傳、發送遊戲連結。**遊戲不在 LINE 裡玩。**
- **LINE userId 是主要識別**，底下分多個題庫（課本第一課、社團第一課…）。
- **圖片辨識跑在使用者自己的機器**（RTX 5060 + PaddleOCR），不呼叫雲端 AI，零成本。
- 遊戲本身**完全不呼叫任何 AI**，玩多少次都不產生費用。

## 2. 現況

| 項目 | 狀態 |
| --- | --- |
| 遊戲前端（含自建字庫、音標、發音） | 完成，有測試 |
| LINE Bot 指令與文字上傳 | 完成，端對端測試通過 |
| 題庫分層、測驗連結 | 完成 |
| 本地 OCR 佇列與配對演算法 | 完成，有測試 |
| 圖片辨識實際準確度 | **未驗證**（開發環境無 GPU、無真實課本照片） |
| LINE 實際收發 | **未驗證**（開發環境連不到 `api.line.me`，全程以測試替身驗證） |
| 部署 | **尚未部署** |
| 管理後台 | **未開始**（需求未定） |

---

## 3. 三種整合方式

### A. 另開一個 Messaging API channel（最單純）

單字機器人自己一個 channel，Webhook URL 指向 `POST /line/webhook`。
既有 bot 完全不受影響。**如果沒有非得共用同一個 LINE 帳號的理由，選這個。**

### B. 由既有 bot 轉發（共用同一個 LINE 帳號）

一個 channel 只能有一個 Webhook URL。既有 bot 保留 webhook，
把單字相關的事件轉發到 `POST /line/forward`。

這條路**不驗 LINE 簽章**（原始 body 位元組在轉發過程中很難保持不變），
改用共用金鑰 `FORWARD_KEY` 驗證呼叫端身分。

```js
// 在既有 bot 的 webhook handler 裡
const FORWARD_URL = 'https://<worker>.workers.dev/line/forward';

function isVocabEvent(event) {
  if (event.type !== 'message') return false;
  if (event.message.type === 'image') return true;          // 課本照片
  const text = (event.message.text || '').trim();
  return /^[/／](說明|題庫|新增|切換|刪除|清單|移除|玩|測驗|考試)/.test(text)
      || /^[a-zA-Z][a-zA-Z'\- ]{1,}/.test(text);            // 看起來像英文單字
}

for (const event of body.events) {
  if (!isVocabEvent(event)) {
    await handleNervEvent(event);          // 原本的邏輯
    continue;
  }
  await fetch(FORWARD_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forward-key': process.env.FORWARD_KEY },
    body: JSON.stringify({ events: [event] })
  });
  // 這裡不要回覆！見下方說明
}
```

> **關鍵：`replyToken` 只能用一次。** 轉發出去的事件，既有 bot 不可以也回覆，
> 否則單字系統的回覆會失敗（會自動退回用 push，但那會消耗 LINE 的訊息額度）。

判斷條件 `isVocabEvent` 請依實際情況調整。若希望更明確，可以改成前綴觸發
（例如只有 `單字 apple 蘋果` 才轉發），避免誤判既有功能的訊息。

### C. 把程式碼併進既有專案

核心邏輯都是無框架的純函式，可以直接搬：

| 模組 | 相依 | 說明 |
| --- | --- | --- |
| `server/src/parse.js` | 無 | 指令解析、英中分界、單字驗證 |
| `server/src/db.js` | D1 介面 | 換資料庫只需改這一支 |
| `server/src/line.js` | fetch | 簽章驗證、回覆、推播、取圖 |
| `ocr/pairing.py` | 無 | OCR 文字框 → 英中配對 |
| `ocr/dictionary.py` | 無 | 拼字修正 |

`db.js` 用的是 D1 的 `prepare().bind().first()/.all()/.run()/.batch()`。
換成別的資料庫時注意：**D1 的 `.bind()` 會回傳新的 statement**，
`batch([stmt.bind(a), stmt.bind(b)])` 才會正確；有些 driver 是就地修改，會全部綁到最後一組參數。

---

## 4. HTTP 介面

Base URL 為部署後的 Worker 網址。所有回應皆為 JSON（取圖除外）。

### LINE 入口

| 方法 | 路徑 | 驗證 | 說明 |
| --- | --- | --- | --- |
| POST | `/line/webhook` | `x-line-signature`（HMAC-SHA256） | LINE 官方 webhook |
| POST | `/line/forward` | `x-forward-key` | 既有 bot 轉發事件用（整合方式 B） |

`/line/forward` 的 body 接受三種形狀：`{events:[…]}`、事件陣列、單一事件物件。
回 `{ok:true, accepted:N}`。

### 遊戲網頁

| 方法 | 路徑 | 驗證 | 回應 |
| --- | --- | --- | --- |
| GET | `/api/decks?t=<token>` | web token | `{name, decks:[{id,name,word_count,created_at}]}` |
| GET | `/api/deck/<id>?t=<token>` | web token | `{id, name, words:[{word,zh,ipa,hint}]}` |
| POST | `/api/liff` | LIFF idToken | `{token, name, decks}` |

`token` 是每個使用者的隨機字串（`users.web_token`，32 hex），
由 bot 的 `/玩` 或 `/測驗` 指令產生連結時帶出。跨使用者存取會回 401／404。

### 本地 OCR

| 方法 | 路徑 | 驗證 | 說明 |
| --- | --- | --- | --- |
| POST | `/ocr/claim` | `x-ocr-key` | 領一份待辨識工作，無工作回 `{job:null}` |
| GET | `/ocr/image/<jobId>` | `x-ocr-key` | 由 Worker 代為向 LINE 下載圖片 |
| POST | `/ocr/result` | `x-ocr-key` | 回報結果 |
| GET | `/ocr/status` | `x-ocr-key` | `{pending:N}` |

`/ocr/result` 的 body：

```json
{
  "jobId": 12,
  "words":   [{ "word": "mountain", "zh": "山" }],
  "fixes":   [{ "from": "rnountain", "to": "mountain" }],
  "suspect": ["zzzqqq"]
}
```

失敗時改送 `{"jobId":12, "error":"CUDA out of memory"}`。

### 其他

`GET /health` → `{ok:true}`，不需驗證。

---

## 5. 資料模型（Cloudflare D1 / SQLite）

```
users (line_user_id PK, display_name, current_deck_id, web_token UNIQUE, created_at, updated_at)
  └─ decks (id PK, line_user_id, name, created_at)         UNIQUE(line_user_id, name)
       └─ words (id PK, deck_id, word, zh, ipa, hint, source, created_at)   UNIQUE(deck_id, word)

dict (word PK, ipa)        CMU 發音辭典 117,449 筆，供自動補音標
jobs (id PK, line_user_id, deck_id, status, source, line_message_id,
      reply_token, result_count, error, attempts, created_at, claimed_at, done_at)
```

- `words.word` 一律小寫，只允許 a–z、空白、連字號、撇號，至少兩個字母。
- `words.zh`、`words.ipa`、`words.hint` 都可以是空字串。
- 完整定義見 `server/schema.sql`。

---

## 6. 環境變數

用 `wrangler secret put` 設定機密，不要寫進 `wrangler.toml`。

| 名稱 | 必要 | 用途 |
| --- | --- | --- |
| `LINE_CHANNEL_SECRET` | ✅ | webhook 簽章驗證 |
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ | 回覆、推播、取圖 |
| `OCR_WORKER_KEY` | 本地 OCR 需要 | `/ocr/*` 的共用金鑰 |
| `FORWARD_KEY` | 整合方式 B 需要 | `/line/forward` 的共用金鑰 |
| `LIFF_CHANNEL_ID` | 用 LIFF 才需要 | 驗證 idToken |
| `ANTHROPIC_API_KEY` | `OCR_MODE=cloud` 才需要 | 雲端圖片辨識 |
| `GAME_URL` | ✅（vars） | 組出遊戲連結的基底網址 |
| `OCR_MODE` | vars，預設 `local` | `local` 走本地 GPU、`cloud` 走 Claude |
| `LINE_API_BASE` / `LINE_DATA_API_BASE` | 測試用 | 覆寫 LINE API 位址，正式環境不要設 |

---

## 7. LINE Bot 指令

非指令的文字一律當作加單字，一行一筆。英中分界的判斷順序是
「明確分隔符號（`,` `，` `=` `:` `：` `、` tab）→ 第一個中文字」，
所以 `ice cream 冰淇淋` 不會被空白切錯。

| 指令 | 作用 |
| --- | --- |
| `/說明` `/help` | 用法 |
| `/題庫` | 列出題庫，▶ 標示目前收單字的那個 |
| `/新增 <名稱>` | 建立題庫並切換 |
| `/切換 <名稱>` | 切換題庫 |
| `/刪除 <名稱>` | 刪除整個題庫 |
| `/清單` | 目前題庫的單字 |
| `/移除 <單字>` | 刪掉一個單字 |
| `/測驗` `/測驗 <名稱>` | 取得測驗連結（`?t=<token>&d=<deckId>`） |
| `/玩` | 所有題庫的總覽連結 |

全形斜線 `／` 與英文指令皆可。未指定題庫時會自動建立「我的單字」。

---

## 8. 遊戲網頁如何取得題庫

前端是純靜態網頁（無框架、無建置步驟），設定只有 `config.js` 兩行：

```js
var API_BASE = 'https://<worker>.workers.dev';   // 留空則完全停用雲端功能
var LIFF_ID  = '';                                // 填了才會載入 LIFF SDK
```

`cloud.js` 負責取題庫：優先用 LIFF 自動識別，否則用網址上的 `?t=<token>`，
讀完立刻把參數從網址列移除。`?d=<deckId>` 會直接開始那一份測驗。

`API_BASE` 留空時整組雲端功能靜默停用，內建字庫與瀏覽器本機字庫照常運作 ——
**接手時可以先不動前端，後端跑通了再填這一行。**

---

## 9. 本地 OCR 端（`ocr/`）

跑在使用者自己的機器，**主動輪詢**領工作，不需要固定 IP 或開放連接埠。

```bash
export WORKER_URL=https://<worker>.workers.dev
export OCR_KEY=<OCR_WORKER_KEY>
python3 ocr/service.py
```

先驗辨識效果（不連 Worker）：`python3 ocr/service.py --once ./課本.jpg`

兩個值得知道的細節：

- **`pairing.py`**：OCR 回傳的是帶座標的文字框，順序不可靠。依字高比例分行、
  行內左到右配對（雙欄 `en zh en zh` 自然切成兩筆）、中文在下方時跨行以水平位置配對。
- **`dictionary.py`**：用 CMU 辭典修 OCR 錯字（`rnountain`→`mountain`、`app1e`→`apple`）。
  **本來就正確的字一律原樣保留**，測試以 37 個易混淆真實單字把關。

配不到中文不影響可玩性 —— 遊戲會切換成「聽發音拼單字」模式。

---

## 10. 已知限制與未完成

1. **LINE 實際收發未驗證。** 開發環境連不到 `api.line.me`，全程以測試替身驗證。
   部署後請跑 `npm run check`，再用手機實測。
2. **圖片辨識準確度未驗證。** 沒有 GPU 也沒有真實課本照片。
   配對與拼字修正的邏輯有完整測試，但 PaddleOCR 在真實照片上的表現要實測。
3. **尚未部署。** Cloudflare 與 LINE 的帳號都在使用者手上。
4. **沒有管理後台。** 需求未定：是只有本人使用，還是老師管學生、要看作答紀錄。
5. **沒有作答紀錄。** 目前分數只存在瀏覽器的一局之內，沒有回寫伺服器。
   要做學習分析的話，這是第一個要補的。
6. **題庫沒有共享機制。** 每個 LINE 帳號的題庫彼此獨立，老師無法把題庫發給學生。
7. `users.web_token` 沒有失效機制，連結外流等同帳號外流。

---

## 11. 測試

```bash
cd server
npm install
npm test            # 88 項：解析、bot 流程、簽章、佇列
npm run db:local    # 建本機 D1、匯入辭典
npm run test:e2e    # 38 項端對端，用 workerd 實際執行 Worker

cd ../ocr
python3 test_pairing.py     # 14 項：各種課本排版的配對
python3 test_dictionary.py  # 27 項：拼字修正（含「不可改壞正確字」）
python3 test_service.py     # 19 項：輪詢、下載、回報、錯誤處理
```

`server/test/d1-shim.mjs` 用真的 SQLite 模擬 D1，所以 SQL 本身也在測試範圍內。
`server/test/e2e.mjs` 用 workerd 實際跑 Worker，只有 LINE 那端是替身，可重複執行。

部署後：`npm run check`（需帶 `WORKER_URL`、`LINE_CHANNEL_SECRET`、`OCR_WORKER_KEY`）。

---

## 12. 檔案地圖

```
index.html  styles.css  game.js  words.js  ipa.js  decks.js   遊戲前端
config.js                                                     部署設定（兩行）
cloud.js                                                      讀取 LINE 題庫
ipa/a.js … ipa/z.js                                           CMU 辭典轉 IPA，117,449 字

server/
  src/index.js      路由、指令處理、訊息組裝、OCR 佇列 API、轉發入口
  src/parse.js      指令與單字解析（純函式）
  src/line.js       簽章驗證、回覆、推播、取圖
  src/db.js         D1 存取、音標批次查詢、佇列
  src/extract.js    雲端圖片辨識（OCR_MODE=cloud 才會用到）
  schema.sql        資料表
  tools/gen-dict-sql.mjs    產生辭典匯入 SQL
  tools/check-deploy.mjs    部署後檢查

ocr/
  service.py        輪詢、下載、辨識、回報
  pairing.py        文字框 → 英中配對
  dictionary.py     拼字修正
```

詳細說明：`README.md`（遊戲）、`server/README.md`（後端部署）、`ocr/README.md`（本地 OCR）。
