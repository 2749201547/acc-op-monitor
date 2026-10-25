import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  listAccounts,
  createAccount,
  beginLogin,
  pollLogin,
  stopLogin,
  removeAccount,
  getAccount,
} from './services/accounts.js';
import {
  listConversations,
  listMessages,
  syncOne,
  syncAll,
  reply,
} from './services/inbox.js';
import { closeAll } from './browser/manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3788;
const dataDir = path.join(__dirname, '..', 'data');

app.use(express.json({ limit: '2mb' }));
app.use('/media', express.static(dataDir));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/accounts', (_req, res) => {
  res.json(listAccounts());
});

app.post('/api/accounts', (req, res) => {
  const account = createAccount(req.body?.label);
  res.json(account);
});

app.get('/api/accounts/:id', (req, res) => {
  const a = getAccount(req.params.id);
  if (!a) return res.status(404).json({ error: '账号不存在' });
  res.json(a);
});

app.post('/api/accounts/:id/login', async (req, res) => {
  try {
    const result = await beginLogin(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/accounts/:id/login/status', async (req, res) => {
  try {
    const result = await pollLogin(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/accounts/:id/login/cancel', async (req, res) => {
  await stopLogin(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/accounts/:id', async (req, res) => {
  await removeAccount(req.params.id);
  res.json({ ok: true });
});

app.get('/api/conversations', (req, res) => {
  res.json(listConversations(req.query.accountId || null));
});

app.get('/api/conversations/:id/messages', (req, res) => {
  res.json(listMessages(req.params.id));
});

app.post('/api/sync', async (_req, res) => {
  try {
    const results = await syncAll();
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/accounts/:id/sync', async (req, res) => {
  try {
    const result = await syncOne(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/conversations/:id/reply', async (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: '内容不能为空' });
  try {
    const result = await reply(req.params.id, text);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`TikTokchat 已启动: http://localhost:${PORT}`);
});

async function shutdown() {
  console.log('正在关闭...');
  await closeAll();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
