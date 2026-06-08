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

// ── Middleware ───────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Explicit fallback so GET / always serves index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB — ffmpeg handles compression
  fileFilter(req, file, cb) {
    if (/^(audio|video)\//.test(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported MIME type: ${file.mimetype}`));
  },
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
app.post('/api/upload-and-analyze', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });

  const taskId      = crypto.randomUUID();
  const instruction = (req.body.instruction || '').trim();

  tasks.set(taskId, { status: 'transcribing', createdAt: Date.now() });
  runPipeline(taskId, req.file.path, instruction); // fire and forget

  res.json({ taskId });
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

// Result page — serve result.html for any /result/:taskId path
app.get('/result/:taskId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/result.html'));
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Server → http://localhost:${PORT}`));
