require('dotenv').config();
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const GROQ_SIZE_LIMIT = 25 * 1024 * 1024; // 25 MB
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

// Non-retryable HTTP status codes
const FATAL_STATUSES = new Set([400, 401, 403, 404]);

// ── Key presence check at startup ───────────────────────────────
const GROQ_KEY = process.env.GROQ_API_KEY || '';
if (!GROQ_KEY) {
  console.error('[Groq] ❌ GROQ_API_KEY is not set');
} else {
  console.log(`[Groq] key loaded: ${GROQ_KEY.slice(0, 8)}…`);
}

const groq = new OpenAI({
  apiKey: GROQ_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

// ---------------------------------------------------------------------------
// ffmpeg helpers
// ---------------------------------------------------------------------------

async function checkFfmpeg() {
  try {
    await execFileAsync('ffmpeg', ['-version']);
  } catch {
    throw new Error('ffmpeg not found. Install it to handle audio files larger than 25 MB.');
  }
}

/**
 * Compress audio to mono 16 kHz MP3 at the given bitrate (kbps).
 * Returns the path to the temp file (caller must delete it).
 */
async function compressAudio(inputPath, bitrateKbps = 32) {
  const outputPath = path.join(os.tmpdir(), `groq-${Date.now()}.mp3`);
  await execFileAsync('ffmpeg', [
    '-i', inputPath,
    '-vn',           // drop video stream if any
    '-ar', '16000',  // 16 kHz — adequate for speech recognition
    '-ac', '1',      // mono
    '-b:a', `${bitrateKbps}k`,
    '-y',            // overwrite without asking
    outputPath,
  ]);
  return outputPath;
}

/**
 * Ensure the audio file fits within Groq's 25 MB limit.
 * Returns { filePath, isTmp } — caller owns cleanup when isTmp is true.
 */
async function prepareFile(originalPath) {
  const { size } = fs.statSync(originalPath);

  if (size <= GROQ_SIZE_LIMIT) {
    return { filePath: originalPath, isTmp: false };
  }

  const sizeMB = (size / 1024 / 1024).toFixed(1);
  console.warn(`[transcribe] File is ${sizeMB} MB — compressing with ffmpeg (32 kbps mono)...`);

  await checkFfmpeg();
  let tmpPath = await compressAudio(originalPath, 32);

  const compressedSize = fs.statSync(tmpPath).size;
  if (compressedSize > GROQ_SIZE_LIMIT) {
    // Still too large — try again at 16 kbps (handles ~5-hour recordings)
    const v1 = tmpPath;
    console.warn('[transcribe] Still over limit — retrying at 16 kbps...');
    tmpPath = await compressAudio(originalPath, 16);
    fs.rmSync(v1, { force: true });

    if (fs.statSync(tmpPath).size > GROQ_SIZE_LIMIT) {
      fs.rmSync(tmpPath, { force: true });
      throw new Error(
        'Audio file exceeds 25 MB even after maximum compression. ' +
        'Split it into shorter segments before transcribing.'
      );
    }
  }

  const finalMB = (fs.statSync(tmpPath).size / 1024 / 1024).toFixed(1);
  console.log(`[transcribe] Compressed to ${finalMB} MB`);
  return { filePath: tmpPath, isTmp: true };
}

// ---------------------------------------------------------------------------
// Transcription with retry
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callWhisper(filePath) {
  const response = await groq.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-large-v3-turbo',
    language: 'zh',
    response_format: 'text',
  });
  // SDK returns the text string directly for response_format: 'text'
  return response;
}

function logGroqError(err, context = '') {
  const status  = err.status  ?? 'N/A';
  const type    = err.error?.type    ?? err.name ?? 'unknown';
  const detail  = err.error?.message ?? err.message ?? String(err);
  console.error(
    `[Groq][transcribe] ❌ ${context}` +
    `  status=${status}  type=${type}` +
    `  message=${detail}`
  );
  if (status === 401) {
    console.error('[Groq][transcribe] → 401 Invalid API Key. 请检查 Render 环境变量 GROQ_API_KEY 是否正确');
  }
}

async function transcribeWithRetry(filePath) {
  let lastErr;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callWhisper(filePath);
    } catch (err) {
      lastErr = err;
      logGroqError(err, `attempt ${attempt}/${MAX_RETRIES} `);

      if (FATAL_STATUSES.has(err.status)) {
        throw err; // No point retrying auth/bad-request errors
      }

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * 2 ** (attempt - 1); // 1 s, 2 s, 4 s
        console.warn(`[Groq][transcribe] retrying in ${delay / 1000}s...`);
        await sleep(delay);
      }
    }
  }

  throw new Error(`[Groq] Transcription failed after ${MAX_RETRIES} attempts: ${lastErr.message}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transcribe an audio file using Groq Whisper.
 * @param {string} filePath  Absolute path to the audio file.
 * @returns {Promise<string>} Transcribed text.
 */
async function transcribeAudio(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  const { filePath: workingPath, isTmp } = await prepareFile(filePath);

  try {
    console.log(`[transcribe] Sending to Groq Whisper: ${path.basename(workingPath)}`);
    const text = await transcribeWithRetry(workingPath);
    console.log(`[transcribe] Done — ${text.length} characters`);
    return text;
  } finally {
    if (isTmp) fs.rmSync(workingPath, { force: true });
  }
}

module.exports = { transcribeAudio };
