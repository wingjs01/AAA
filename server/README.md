# LINE Bot 後端

用 LINE 上傳單字到自己的題庫：打字或直接拍課本照片，系統辨識出「英文 ↔ 中文」，
自動補上音標，存進以 LINE 帳號區分的題庫，遊戲網頁就能直接玩。

```
LINE 使用者 ──圖片/文字──▶ LINE 平台 ──webhook──▶ Cloudflare Worker
                                                      │
                                    Claude 視覺辨識 ◀──┤
                                    D1 資料庫       ◀──┤
                                                      ▼
                                          回覆「已收進課本第一課：8 個」
遊戲網頁 ?t=<token> ──▶ Worker API ──▶ 你的題庫
```

## 使用方式（部署完成後）

直接傳訊息就是加單字，一行一個：

```
apple 蘋果
ice cream 冰淇淋
banana
```

英文和中文之間用空白、逗號、等號或冒號分隔都可以。片語（`ice cream 冰淇淋`）
會用「第一個中文字」當分界，不會被空白切錯。沒寫中文也能收。

或**直接拍課本、講義、筆記的照片傳過來**。

| 指令 | 作用 |
| --- | --- |
| `/題庫` | 看所有題庫，▶ 標示目前正在收單字的那個 |
| `/新增 課本第一課` | 建立題庫並切換過去 |
| `/切換 社團第一課` | 換題庫 |
| `/清單` | 看目前題庫的單字 |
| `/移除 apple` | 刪掉一個單字 |
| `/刪除 課本第一課` | 刪掉整個題庫 |
| `/玩` | 取得你的專屬遊戲連結 |
| `/說明` | 用法說明 |

---

## 部署步驟

### 1. 建立 LINE 官方帳號

1. 到 [LINE Developers](https://developers.line.biz/console/) 登入
2. 建立 Provider → 建立 **Messaging API** channel
3. 記下 **Channel secret**（Basic settings 頁）
4. 發行並記下 **Channel access token**（Messaging API 頁，長期 token）
5. 關閉「自動回應訊息」、開啟「Webhook」（Messaging API 頁的 LINE Official Account features）

### 2. 建立 Cloudflare 資源

```bash
cd server
npm install
npx wrangler login

# 建立 D1 資料庫，把印出的 database_id 填進 wrangler.toml
npx wrangler d1 create hangman

# 建表
npx wrangler d1 execute hangman --remote --file=schema.sql

# 匯入 CMU 發音辭典（117,449 筆，約 2.8MB，需要一兩分鐘）
npm run seed:gen
npx wrangler d1 execute hangman --remote --file=seed-dict.sql
```

### 3. 設定機密資訊

**不要**把這些寫進 `wrangler.toml`：

```bash
npx wrangler secret put LINE_CHANNEL_SECRET        # 步驟 1 的 Channel secret
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN  # 步驟 1 的 access token
npx wrangler secret put OCR_WORKER_KEY             # 本地 OCR 的共用金鑰，自己想一組長字串
npx wrangler secret put ANTHROPIC_API_KEY          # 只有 OCR_MODE=cloud 才需要
npx wrangler secret put LIFF_CHANNEL_ID            # 用 LIFF 才需要
```

把 `wrangler.toml` 的 `GAME_URL` 改成你的遊戲網頁網址。

### 3.5 先在本機驗一次（不用部署、不會連到真的 LINE）

```bash
npm run db:local     # 建本機 D1、匯入辭典
npm run test:e2e     # 用 workerd 真的跑 Worker，LINE 端用測試替身
```

32 項端對端測試會走完整條鏈路：簽章驗證 → 指令 → 寫入 D1 → 音標補齊 →
圖片佇列 → 本地 OCR 取件回報 → 網頁 API 權限隔離。全過才往下走。

### 4. 部署並接上 LINE

```bash
npx wrangler deploy
```

部署完先檢查一遍：

```bash
WORKER_URL=https://你的.workers.dev \
LINE_CHANNEL_SECRET=你的secret \
OCR_WORKER_KEY=你的金鑰 \
npm run check
```

都通過之後，把網址加上 `/line/webhook` 填進 LINE Developers 的 **Webhook URL**，
按 Verify。然後用手機加這個官方帳號為好友，傳一句 `apple 蘋果` 測試。

> **如果這個 LINE 帳號已經在跑別的功能**：一個 channel 只能有一個 Webhook URL，
> 改指過來會讓原本的功能停止運作。建議另外開一個 Messaging API channel 給單字機器人，
> 或是讓原本的後端把單字相關的事件轉發到這個 Worker。

### 5. 讓遊戲網頁讀得到題庫

編輯專案根目錄的 `config.js`：

```js
var API_BASE = 'https://hangman-line-bot.你的名字.workers.dev';
var LIFF_ID  = '';   // 用 LIFF 才填
```

在 LINE 輸入 `/玩` 取得專屬連結，打開就會看到「LINE 題庫」區塊。

### 6.（選用）LIFF：在 LINE 裡直接玩

在 LINE Developers 的 channel 下新增 LIFF app，Endpoint URL 填遊戲網址，
Scope 勾選 `profile` 和 `openid`。把 LIFF ID 填進 `config.js`，
Channel ID 用 `wrangler secret put LIFF_CHANNEL_ID` 設定。
之後從 LINE 點連結進去會自動認出身分，不需要專屬連結。

---

## 成本

| 項目 | 費用 |
| --- | --- |
| Cloudflare Workers + D1 | 免費額度內（每天 10 萬次請求、5GB 資料庫） |
| LINE 回覆訊息 | 免費、無上限（bot 只用 reply 不用 push） |
| 文字上傳單字 | **完全免費**，不呼叫任何 AI |
| 圖片辨識（`OCR_MODE=local`） | **免費**，用你自己的 RTX 5060 跑 PaddleOCR |
| 圖片辨識（`OCR_MODE=cloud`） | 每張約 US$0.02（Claude Opus 5） |

玩遊戲本身不產生任何費用。

## 測試

```bash
npm test
```

- `test/parse.test.mjs`（36 項）指令解析、英中分界、單字驗證
- `test/bot.test.mjs`（24 項）題庫管理、加字去重、音標補齊、多使用者隔離
- `test/security.test.mjs`（13 項）LINE 簽章驗證、辨識結果清洗
- `test/queue.test.mjs`（9 項）工作佇列：領取互斥、逾時重排、重試上限
- `test/e2e.mjs`（32 項）端對端：用 workerd 實際執行 Worker，
  只有 LINE 那端是替身。`npm run test:e2e`

本地 OCR 端另有 28 項測試，見 [`../ocr/README.md`](../ocr/README.md)。

`test/d1-shim.mjs` 用真的 SQLite 模擬 D1，所以 SQL 本身也在測試範圍內。

> **LINE 的實際收發沒有自動測試。** 開發環境連不到 `api.line.me`，
> 這段必須部署後用手機驗證。圖片辨識的配對邏輯有完整測試
> （見 `../ocr/test_pairing.py`），但 PaddleOCR 在真實照片上的辨識率
> 要用你的機器跑 `service.py --once` 才知道。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `src/index.js` | 路由、指令處理、訊息組裝 |
| `src/parse.js` | 指令與單字解析（純函式） |
| `src/line.js` | LINE 簽章驗證、回覆、取圖 |
| `src/extract.js` | 圖片 → 單字（Claude 視覺） |
| `src/db.js` | D1 存取、音標批次查詢 |
| `schema.sql` | 資料表定義 |
| `tools/gen-dict-sql.mjs` | 由 `ipa/*.js` 產生辭典匯入 SQL |

圖片辨識的本地端在 [`../ocr/`](../ocr/)。
