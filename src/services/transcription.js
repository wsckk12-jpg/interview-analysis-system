const OpenAI = require('openai');
const fs = require('fs');

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

async function transcribeAudio(filePath) {
  const response = await groq.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-large-v3',
    response_format: 'text',
  });
  return response;
}

module.exports = { transcribeAudio };
