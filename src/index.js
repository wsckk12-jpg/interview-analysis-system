require('dotenv').config();
const express = require('express');
const interviewRouter = require('./routes/interview');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api/interview', interviewRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
