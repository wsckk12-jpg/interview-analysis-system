require('dotenv').config();
const OpenAI = require('openai');
const { SYSTEM_PROMPT } = require('./systemPrompt');

// ── Key presence check at startup ───────────────────────────────
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
if (!DEEPSEEK_KEY) {
  console.error('[DeepSeek] ❌ DEEPSEEK_API_KEY is not set');
} else {
  console.log(`[DeepSeek] key loaded: ${DEEPSEEK_KEY.slice(0, 8)}…`);
}

const deepseek = new OpenAI({
  apiKey: DEEPSEEK_KEY,
  baseURL: 'https://api.deepseek.com',
});

// Strip markdown code fences that models sometimes wrap JSON in
function extractJson(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function logDeepSeekError(err, context = '') {
  const status = err.status  ?? 'N/A';
  const type   = err.error?.type    ?? err.name ?? 'unknown';
  const detail = err.error?.message ?? err.message ?? String(err);
  console.error(
    `[DeepSeek][analyze] ❌ ${context}` +
    `  status=${status}  type=${type}` +
    `  message=${detail}`
  );
  if (status === 401) {
    console.error('[DeepSeek][analyze] → 401 Invalid API Key. 请检查 Render 环境变量 DEEPSEEK_API_KEY 是否正确');
  }
}

async function callDeepSeek(messages) {
  try {
    const completion = await deepseek.chat.completions.create({
      model: 'deepseek-v4-flash',
      max_tokens: 8000,
      temperature: 0.3,
      messages,
    });
    return completion.choices[0].message.content;
  } catch (err) {
    logDeepSeekError(err, 'callDeepSeek ');
    throw err;
  }
}

/**
 * Analyze an interview transcript with DeepSeek.
 * @param {string} transcript  Full transcript text.
 * @returns {Promise<object>}  Parsed analysis object matching the JSON schema in systemPrompt.js.
 */
async function analyzeInterview(transcript, instruction = '') {
  const userContent = instruction
    ? `以下是客户访谈记录。\n\n分析侧重点：${instruction}\n\n访谈记录：\n${transcript}`
    : `以下是客户访谈记录，请按要求分析并输出JSON：\n\n${transcript}`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  console.log('[analyze] Calling DeepSeek...');
  const raw = await callDeepSeek(messages);

  try {
    const result = JSON.parse(extractJson(raw));
    console.log('[analyze] Done');
    return result;
  } catch {
    // Model returned invalid JSON — send the bad response back and ask it to fix
    console.warn('[analyze] JSON parse failed, retrying with correction prompt...');

    const retryMessages = [
      ...messages,
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content:
          '你的输出不是合法的JSON。请只输出纯JSON对象，不要包含任何解释文字、代码块标记或其他内容。',
      },
    ];

    const rawRetry = await callDeepSeek(retryMessages);

    try {
      const result = JSON.parse(extractJson(rawRetry));
      console.log('[analyze] Done (after retry)');
      return result;
    } catch (err) {
      throw new Error(
        `DeepSeek returned invalid JSON after retry: ${err.message}\n\n` +
        `Response preview: ${rawRetry.slice(0, 300)}`
      );
    }
  }
}

module.exports = { analyzeInterview };
