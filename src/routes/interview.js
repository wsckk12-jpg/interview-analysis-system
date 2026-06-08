const express = require('express');
const multer = require('multer');
const path = require('path');
const { transcribeAudio } = require('../services/transcription');
const { analyzeInterview } = require('../services/analysis');
const { generateReport } = require('../services/report');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `${timestamp}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg', 'video/mp4'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — Groq Whisper limit
});

router.post('/analyze', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }

  try {
    console.log(`[1/3] Transcribing: ${req.file.filename}`);
    const transcript = await transcribeAudio(req.file.path);

    console.log('[2/3] Analyzing with DeepSeek...');
    const analysis = await analyzeInterview(transcript);

    console.log('[3/3] Generating Word report...');
    const reportPath = await generateReport({ transcript, analysis, filename: req.file.originalname });

    res.download(reportPath, `interview-report-${Date.now()}.docx`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
