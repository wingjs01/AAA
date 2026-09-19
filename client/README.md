# 整合客戶端

零相依，可在 Node 18+、Cloudflare Workers、Deno、瀏覽器直接使用。
複製 `hangman-client.js` 到你的專案即可，不需安裝任何套件。

```js
import { HangmanClient, isVocabEvent } from './hangman-client.js';

const hm = new HangmanClient({
  baseUrl:    'https://hangman-line-bot.xxx.workers.dev',
  forwardKey: process.env.FORWARD_KEY,   // 轉發事件用
  ocrKey:     process.env.OCR_KEY        // 本地 OCR 用
});
```

## 既有 LINE Bot 整合（最常見）

```js
// 在你原本的 webhook handler 裡
const { rest } = await hm.route(body.events);

for (const event of rest) {
  await yourExistingHandler(event);      // 不屬於單字系統的照舊
}
```

`route()` 會把單字相關事件轉發過去、其餘還給你。
判斷規則可自訂：`hm.route(events, myPredicate)`。

> **replyToken 只能用一次。** 轉發出去的事件不要在你那邊也回覆，
> 否則單字系統的回覆會失敗（會退回用 push，消耗 LINE 訊息額度）。

## 讀題庫

```js
const { decks } = await hm.listDecks(token);
const { words } = await hm.getDeck(token, decks[0].id);
// words: [{ word, zh, ipa, hint }]

const url = hm.gameUrl('https://game.example.com', token, decks[0].id);
```

## 本地 OCR

```js
const job = await hm.claimJob();
if (job) {
  const image = await hm.fetchJobImage(job);
  try {
    await hm.submitResult(job.id, { words: [{ word: 'mountain', zh: '山' }] });
  } catch (e) {
    await hm.submitError(job.id, e.message);
  }
}
```

## 錯誤處理

所有失敗都丟 `HangmanError`，帶 `status` 與 `body`：

```js
import { HangmanError } from './hangman-client.js';

try {
  await hm.listDecks(token);
} catch (e) {
  if (e instanceof HangmanError && e.status === 401) { /* token 失效 */ }
  if (e.status === 0) { /* 連不到或逾時 */ }
}
```

## 方法

| 方法 | 說明 |
| --- | --- |
| `health()` | 健康檢查 |
| `route(events, predicate?)` | 分流並轉發，回傳 `{forwarded, rest, accepted}` |
| `forwardEvent(e)` / `forwardEvents(es)` | 直接轉發 |
| `listDecks(token)` | 題庫清單 |
| `getDeck(token, deckId)` | 題庫內的單字 |
| `liffLogin(idToken)` | LIFF 換取使用者資料 |
| `gameUrl(base, token, deckId?)` | 組出遊戲／測驗連結 |
| `claimJob()` / `fetchJobImage(job)` | 領工作、取圖 |
| `submitResult(id, r)` / `submitError(id, e)` | 回報結果 |
| `queueStatus()` | `{pending}` |
| `isVocabEvent(event)` | 判斷是否為單字系統的事件（具名匯出） |

介面定義見 `../openapi.yaml`。測試：`cd server && npm run test:client`（23 項）。
