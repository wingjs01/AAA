/**
 * 圖片 → 單字清單
 * 用 Claude 的視覺能力直接抽出「英文 ↔ 中文」配對，
 * 比傳統 OCR 再自己拆欄位可靠得多：課本的雙欄排版、
 * 中英交錯、手寫註記都能正確配對。
 */
import Anthropic from '@anthropic-ai/sdk';
import { normalizeWord } from './parse.js';

const MODEL = 'claude-opus-5';

const TOOL = {
  name: 'record_vocabulary',
  description: '記錄從圖片中辨識出的英文單字與其中文意思',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      words: {
        type: 'array',
        description: '辨識出的單字，依照圖片由上到下、由左到右的順序',
        items: {
          type: 'object',
          properties: {
            word: {
              type: 'string',
              description: '英文單字或片語，保留原本的拼寫（不要改成單複數或變化形）'
            },
            zh: {
              type: 'string',
              description: '圖片中與這個英文對應的中文意思。圖片沒有寫中文就填空字串。'
            }
          },
          required: ['word', 'zh'],
          additionalProperties: false
        }
      },
      note: {
        type: 'string',
        description: '如果圖片看不清楚、或根本不是單字表，用一句繁體中文說明；正常辨識則填空字串。'
      }
    },
    required: ['words', 'note'],
    additionalProperties: false
  }
};

const PROMPT = `這是一張英文單字表的照片，可能來自課本、講義、筆記本或手寫小抄。

請抽出裡面所有的英文單字（或片語）以及它們對應的中文意思。

注意事項：
- 保持英文與中文的正確配對。課本常見雙欄排版、或英文在左中文在右，請依實際版面判斷，不要錯位。
- 片語（例如 look forward to）請完整保留成一筆，不要拆成單字。
- 只收英文單字本身，不要包含編號、頁碼、標題、課次、詞性標記（n. v. adj.）、音標。
- 如果某個英文旁邊沒有中文，zh 就填空字串，不要自己翻譯。
- 圖片中沒出現的字不要憑空補上。
- 看不清楚的字寧可略過，也不要猜。

請用 record_vocabulary 工具回報結果。`;

/**
 * @param {string} apiKey
 * @param {{base64: string, mediaType: string}} image
 * @returns {Promise<{words: Array<{word,zh}>, note: string, skipped: Array}>}
 */
export async function extractFromImage(apiKey, image) {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: 'medium' },   // 辨識不需要深度推理，換取較短的回應時間
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'record_vocabulary' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
          { type: 'text', text: PROMPT }
        ]
      }
    ]
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('這張圖片無法處理，請換一張試試。');
  }

  const call = response.content.find((b) => b.type === 'tool_use');
  if (!call) throw new Error('辨識沒有回傳結果，請再傳一次。');

  // 工具輸入一律用解析後的物件，不要對序列化字串做字串比對
  const input = typeof call.input === 'string' ? JSON.parse(call.input) : call.input;
  return cleanResult(input);
}

/** 套用與手動輸入相同的驗證規則，擋掉辨識出的雜訊 */
export function cleanResult(input) {
  const raw = Array.isArray(input && input.words) ? input.words : [];
  const words = [];
  const skipped = [];
  const seen = new Set();

  for (const row of raw) {
    if (!row || typeof row.word !== 'string') continue;
    const chk = normalizeWord(row.word);
    if (chk.error) { skipped.push({ text: row.word, reason: chk.error }); continue; }
    if (seen.has(chk.word)) continue;
    seen.add(chk.word);
    words.push({ word: chk.word, zh: typeof row.zh === 'string' ? row.zh.trim() : '' });
  }

  return { words, note: (input && input.note) || '', skipped };
}
