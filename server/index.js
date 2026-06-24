import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.post('/api/hermes/chat', async (req, res) => {
  const { message, context } = req.body ?? {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const prompt = context ? `[${context}] ${message}` : message;
    const { stdout } = await execAsync(`hermes chat -q ${JSON.stringify(prompt)}`, {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    const reply = (stdout || '').trim();
    return res.json({ reply: reply || 'Agent returned empty output.' });
  } catch (err) {
    console.error('Hermes error:', err);
    return res.status(500).json({ error: err?.message ?? 'Agent failed.' });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  console.log(`Hermes proxy listening on http://localhost:${port}`);
});
