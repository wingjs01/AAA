/**
 * 單字吊人 — 整合用客戶端
 *
 * 零相依，可在 Node 18+、Cloudflare Workers、Deno、瀏覽器直接使用。
 *   import { HangmanClient } from './hangman-client.js';
 */

export class HangmanError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'HangmanError';
    this.status = status;
    this.body = body;
  }
}

/** 看起來是單字系統要處理的事件嗎（給既有 bot 決定要不要轉發） */
export function isVocabEvent(event) {
  if (!event || event.type !== 'message' || !event.message) return false;
  if (event.message.type === 'image') return true;
  if (event.message.type !== 'text') return false;

  const text = String(event.message.text || '').trim();
  if (!text) return false;
  // 結尾用 (\s|$) 而不是 \b —— \b 以 ASCII 判定，中文字後面不成立
  if (/^[/／](說明|help|\?|題庫|decks|新增|new|切換|switch|刪除|delete|清單|list|移除|玩|play|測驗|quiz|考試)(\s|$)/i.test(text)) return true;

  // 每一行都以英文字母開頭 → 視為單字清單
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => /^[A-Za-z][A-Za-z'\-]/.test(l));
}

export class HangmanClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl     Worker 網址
   * @param {string} [opts.forwardKey] 轉發 LINE 事件用（FORWARD_KEY）
   * @param {string} [opts.ocrKey]     本地 OCR 用（OCR_WORKER_KEY）
   * @param {number} [opts.timeout]    毫秒，預設 20000
   * @param {Function} [opts.fetch]    自訂 fetch（測試或特殊執行環境）
   */
  constructor(opts = {}) {
    if (!opts.baseUrl) throw new Error('baseUrl is required');
    this.baseUrl = String(opts.baseUrl).replace(/\/+$/, '');
    this.forwardKey = opts.forwardKey || null;
    this.ocrKey = opts.ocrKey || null;
    this.timeout = opts.timeout || 20000;
    this._fetch = opts.fetch || globalThis.fetch;
  }

  async _call(path, { method = 'GET', headers = {}, body, raw = false } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeout);
    let res;
    try {
      res = await this._fetch(this.baseUrl + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal
      });
    } catch (err) {
      clearTimeout(timer);
      throw new HangmanError(
        err.name === 'AbortError' ? `逾時（${this.timeout}ms）` : `連線失敗：${err.message}`, 0, null);
    }
    clearTimeout(timer);

    if (raw) {
      if (!res.ok) throw new HangmanError(`HTTP ${res.status}`, res.status, null);
      return res;
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* 非 JSON 回應 */ }
    if (!res.ok) {
      throw new HangmanError((data && data.error) || `HTTP ${res.status}`, res.status, data);
    }
    return data;
  }

  _need(key, name) {
    if (!key) throw new Error(`這個操作需要 ${name}`);
    return key;
  }

  /* ---------------- 健康檢查 ---------------- */

  health() {
    return this._call('/health');
  }

  /* ---------------- 既有 bot 轉發事件 ---------------- */

  /**
   * 把 LINE 事件轉發給單字系統處理。
   * 注意：replyToken 只能用一次，轉發出去的事件請不要在你那邊也回覆。
   * @returns {Promise<{ok:boolean, accepted:number}>}
   */
  forwardEvents(events) {
    const list = Array.isArray(events) ? events : [events];
    return this._call('/line/forward', {
      method: 'POST',
      headers: { 'x-forward-key': this._need(this.forwardKey, 'forwardKey') },
      body: { events: list }
    });
  }

  forwardEvent(event) {
    return this.forwardEvents([event]);
  }

  /**
   * 一次處理整批 webhook 事件：屬於單字系統的轉發出去，其餘交還給你。
   * @returns {Promise<{forwarded:Array, rest:Array, accepted:number}>}
   */
  async route(events, predicate = isVocabEvent) {
    const all = Array.isArray(events) ? events : [events];
    const forwarded = all.filter(predicate);
    const rest = all.filter((e) => !forwarded.includes(e));
    let accepted = 0;
    if (forwarded.length) {
      const res = await this.forwardEvents(forwarded);
      accepted = res.accepted || 0;
    }
    return { forwarded, rest, accepted };
  }

  /* ---------------- 題庫讀取 ---------------- */

  /** @returns {Promise<{name:string, decks:Array<{id,name,word_count,created_at}>}>} */
  listDecks(token) {
    return this._call(`/api/decks?t=${encodeURIComponent(token)}`);
  }

  /** @returns {Promise<{id:number, name:string, words:Array<{word,zh,ipa,hint}>}>} */
  getDeck(token, deckId) {
    return this._call(`/api/deck/${encodeURIComponent(deckId)}?t=${encodeURIComponent(token)}`);
  }

  /** 用 LIFF 的 idToken 換取使用者資料 */
  liffLogin(idToken) {
    return this._call('/api/liff', { method: 'POST', body: { idToken } });
  }

  /** 組出遊戲連結；給 deckId 就是直接開始那一份測驗 */
  gameUrl(gameBase, token, deckId) {
    const base = String(gameBase).replace(/\/+$/, '');
    return `${base}?t=${encodeURIComponent(token)}` + (deckId ? `&d=${encodeURIComponent(deckId)}` : '');
  }

  /* ---------------- 本地 OCR ---------------- */

  _ocrHeaders() {
    return { 'x-ocr-key': this._need(this.ocrKey, 'ocrKey') };
  }

  /** 領一份待辨識工作，沒有就回傳 null */
  async claimJob() {
    const data = await this._call('/ocr/claim', { method: 'POST', headers: this._ocrHeaders(), body: {} });
    return data.job || null;
  }

  /** 下載工作對應的圖片，回傳 ArrayBuffer */
  async fetchJobImage(job) {
    const url = typeof job === 'string' ? job : job.imageUrl;
    const path = url.startsWith('http') ? url.slice(this.baseUrl.length) : url;
    const res = await this._call(path, { headers: this._ocrHeaders(), raw: true });
    return res.arrayBuffer();
  }

  submitResult(jobId, { words = [], fixes = [], suspect = [] } = {}) {
    return this._call('/ocr/result', {
      method: 'POST', headers: this._ocrHeaders(),
      body: { jobId, words, fixes, suspect }
    });
  }

  submitError(jobId, error) {
    return this._call('/ocr/result', {
      method: 'POST', headers: this._ocrHeaders(),
      body: { jobId, error: String(error).slice(0, 300) }
    });
  }

  /** @returns {Promise<{pending:number}>} */
  queueStatus() {
    return this._call('/ocr/status', { headers: this._ocrHeaders() });
  }
}

export default HangmanClient;
