const OpenAI = require('openai');

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1',
});

const SYSTEM_PROMPT = `你是一位专业的面试分析师。请对以下面试录音转写内容进行深度分析，并以JSON格式返回结果，包含以下字段：
- summary: 面试整体概述（200字以内）
- candidateProfile: 候选人画像（技能、经验、背景）
- strengths: 优势亮点（数组，每项包含 point 和 detail）
- weaknesses: 不足之处（数组，每项包含 point 和 detail）
- keyAnswers: 关键问题及回答质量评估（数组，每项包含 question、answer、score 1-10、comment）
- overallScore: 综合评分（1-10）
- recommendation: 录用建议（推荐/待定/不推荐）
- nextSteps: 后续建议步骤`;

async function analyzeInterview(transcript) {
  const completion = await deepseek.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `面试转写内容：\n\n${transcript}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  return JSON.parse(completion.choices[0].message.content);
}

module.exports = { analyzeInterview };
