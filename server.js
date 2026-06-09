require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const crypto  = require('crypto');
const fs      = require('fs');

const { transcribeAudio } = require('./src/transcribe');
const { analyzeInterview } = require('./src/analyze');
const { generateReport }   = require('./src/generateReport');

const app  = express();
const PORT = process.env.PORT || 3000;

// Ensure output directory exists
const REPORTS_DIR = path.join(__dirname, 'reports');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── In-memory task store ─────────────────────────────────────────
// Shape: Map<taskId, { status, analysis?, filename?, error?, createdAt }>
const tasks = new Map();

// ── Read HTML pages into memory at startup ────────────────────────
// Avoids runtime path-resolution issues on any host
const INDEX_HTML  = fs.readFileSync(path.join(__dirname, 'public', 'index.html'),  'utf8');
const RESULT_HTML = fs.readFileSync(path.join(__dirname, 'public', 'result.html'), 'utf8');

// ── Middleware ───────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/',              (req, res) => res.type('html').send(INDEX_HTML));
app.get('/result/:taskId', (req, res) => res.type('html').send(RESULT_HTML));

// Accept any field name ('file' or 'audio') and any MIME type.
// iOS Shortcuts often sends application/octet-stream; ffmpeg handles the rest.
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB — ffmpeg will compress if needed
});

// ── Async pipeline ───────────────────────────────────────────────
async function runPipeline(taskId, audioPath, instruction) {
  const task = tasks.get(taskId);
  try {
    task.status = 'transcribing';
    console.log(`[${taskId}] Transcribing...`);
    const transcript = await transcribeAudio(audioPath);

    task.status = 'analyzing';
    console.log(`[${taskId}] Analyzing...`);
    const analysis = await analyzeInterview(transcript, instruction);

    task.status = 'generating';
    console.log(`[${taskId}] Generating report...`);
    const buffer = await generateReport(analysis);

    const filename = `report-${taskId}.docx`;
    fs.writeFileSync(path.join(REPORTS_DIR, filename), buffer);

    task.status   = 'done';
    task.analysis = analysis;
    task.filename = filename;
    console.log(`[${taskId}] Done`);
  } catch (err) {
    task.status = 'error';
    task.error  = err.message;
    console.error(`[${taskId}] Error:`, err.message);
  } finally {
    fs.rmSync(audioPath, { force: true });
  }
}

// ── API routes ───────────────────────────────────────────────────

// POST /api/upload-and-analyze
// Accepts field name 'file' (iOS Shortcuts default) or 'audio'
app.post('/api/upload-and-analyze', (req, res) => {
  upload.any()(req, res, (err) => {
    // ── Multer-level errors (file too large, etc.) ──────────────
    if (err) {
      const msg = err instanceof multer.MulterError
        ? `Upload error: ${err.message}`
        : err.message || 'Upload failed';
      console.error('[upload] Multer error:', msg);
      return res.status(400).json({ error: msg });
    }

    // ── Find the audio file (field name: 'file' or 'audio') ─────
    const file = (req.files || []).find(f =>
      f.fieldname === 'file' || f.fieldname === 'audio'
    ) || (req.files || [])[0]; // fallback: accept any field

    if (!file) {
      console.error('[upload] No file in request. Fields received:', Object.keys(req.body));
      return res.status(400).json({
        error: 'No audio file received. Send the file in a field named "file" or "audio".',
      });
    }

    console.log(
      `[upload] Received — field: ${file.fieldname}, ` +
      `name: ${file.originalname}, ` +
      `size: ${(file.size / 1024).toFixed(0)} KB, ` +
      `mime: ${file.mimetype}`
    );

    const taskId      = crypto.randomUUID();
    const instruction = (req.body.instruction || '').trim();

    tasks.set(taskId, { status: 'transcribing', createdAt: Date.now() });
    runPipeline(taskId, file.path, instruction); // fire and forget

    res.json({ taskId });
  });
});

// GET /api/status/:taskId
app.get('/api/status/:taskId', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const body = { status: task.status };
  if (task.error) body.error = task.error;
  res.json(body);
});

// GET /api/result/:taskId
app.get('/api/result/:taskId', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status !== 'done') return res.status(202).json({ status: task.status });

  res.json({
    analysis:    task.analysis,
    downloadUrl: `/api/download/${task.filename}`,
  });
});

// GET /api/download/:filename
app.get('/api/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // strip path traversal
  const filePath = path.join(REPORTS_DIR, filename);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath, '客户访谈分析报告.docx');
});

app.get('/health', (req, res) => res.json({ status: 'ok', entry: 'server.js' }));

// ── Global error handler — always return JSON, never HTML ────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[unhandled]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Server → http://localhost:${PORT}`));
