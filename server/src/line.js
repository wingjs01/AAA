/** LINE Messaging API 介接 */

const API = 'https://api.line.me/v2/bot';
const DATA_API = 'https://api-data.line.me/v2/bot';

/**
 * 驗證 LINE 的 X-Line-Signature（HMAC-SHA256 + base64）。
 * 沒通過就代表請求不是 LINE 發出的，必須拒絕。
 */
export async function verifySignature(channelSecret, bodyText, signature) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(bodyText));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return timingSafeEqual(expected, signature);
}

/** 固定時間比較，避免以回應時間推敲簽章 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function reply(token, replyToken, messages) {
  const list = Array.isArray(messages) ? messages : [{ type: 'text', text: String(messages) }];
  const res = await fetch(`${API}/message/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ replyToken, messages: list.slice(0, 5) })
  });
  if (!res.ok) {
    console.error('LINE reply failed', res.status, await res.text());
  }
  return res.ok;
}

/** 主動推播（reply 權杖失效時才用，會計入 LINE 的訊息額度） */
export async function push(token, to, messages) {
  const list = Array.isArray(messages) ? messages : [{ type: 'text', text: String(messages) }];
  const res = await fetch(`${API}/message/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: list.slice(0, 5) })
  });
  if (!res.ok) console.error('LINE push failed', res.status, await res.text());
  return res.ok;
}

/** 下載使用者傳來的圖片，回傳 base64 與 MIME type */
export async function getImageContent(token, messageId) {
  const res = await fetch(`${DATA_API}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`取得圖片失敗：${res.status}`);

  const type = res.headers.get('content-type') || 'image/jpeg';
  const buf = await res.arrayBuffer();

  // Claude 的圖片上限是 5MB；LINE 原圖通常在這之內
  if (buf.byteLength > 5 * 1024 * 1024) {
    throw new Error('圖片太大（超過 5MB），請拍小張一點或裁切後再傳');
  }
  return { base64: bufferToBase64(buf), mediaType: normalizeMediaType(type) };
}

function normalizeMediaType(t) {
  const clean = String(t).split(';')[0].trim().toLowerCase();
  return ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(clean) ? clean : 'image/jpeg';
}

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;                 // 一次轉太多會爆堆疊
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function getProfile(token, userId) {
  try {
    const res = await fetch(`${API}/profile/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}
