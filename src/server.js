import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  listAccounts,
  createAccount,
  beginLogin,
  pollLogin,
  stopLogin,
  updateLoginBounds,
  removeAccount,
  getAccount,
  updateAccount,
  updateAccountProxy,
} from './services/accounts.js';
import {
  listConversations,
  listMessages,
  syncOne,
  syncAll,
  reply,
} from './services/inbox.js';
import { closeAll } from './browser/manager.js';
import { PLATFORMS, normalizePlatform } from './browser/platforms/index.js';
import { getDataDir, getPublicDir } from './paths.js';

const app = express();
const PORT = Number(process.env.PORT || 3788);

app.use(express.json({ limit: '2mb' }));
app.use('/media', express.static(getDataDir()));
app.use(express.static(getPublicDir()));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/platforms', (_req, res) => {
  res.json({
    platforms: PLATFORMS.map((id) => ({
      id,
      label: id === 'facebook' ? 'Facebook' : 'TikTok',
    })),
  });
});

app.get('/api/accounts', (_req, res) => {
  res.json(listAccounts());
});

app.post('/api/accounts', (req, res) => {
  try {
    const platform = normalizePlatform(req.body?.platform);
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: '不支持的平台' });
    }
    const account = createAccount(req.body?.label, platform);
    res.json(account);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/accounts/:id', (req, res) => {
  const a = getAccount(req.params.id);
  if (!a) return res.status(404).json({ error: '账号不存在' });
  res.json(a);
});

app.patch('/api/accounts/:id', (req, res) => {
  const a = getAccount(req.params.id);
  if (!a) return res.status(404).json({ error: '账号不存在' });
  const label = req.body?.label;
  if (label === undefined || label === null) {
    return res.status(400).json({ error: '缺少 label' });
  }
  const updated = updateAccount(req.params.id, {
    label: String(label).trim() || '未分组',
  });
  res.json(updated);
});

app.patch('/api/accounts/:id/proxy', async (req, res) => {
  try {
    const updated = await updateAccountProxy(req.params.id, {
      server: req.body?.server,
      username: req.body?.username,
      password: req.body?.password,
      region: req.body?.region,
    });
    res.json(updated);
  } catch (e) {
    const notFound = e.message === '账号不存在';
    res.status(notFound ? 404 : 400).json({ error: e.message });
  }
});

app.post('/api/accounts/:id/login', async (req, res) => {
  try {
    const result = await beginLogin(req.params.id, req.body?.windowBounds || null);
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

app.post('/api/accounts/:id/login/bounds', async (req, res) => {
  try {
    const result = await updateLoginBounds(req.params.id, req.body?.windowBounds || null);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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

app.post('/api/sync', async (req, res) => {
  try {
    const results = await syncAll({ windowBounds: req.body?.windowBounds || null });
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/accounts/:id/sync', async (req, res) => {
  try {
    const result = await syncOne(req.params.id, {
      windowBounds: req.body?.windowBounds || null,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/conversations/:id/reply', async (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: '内容不能为空' });
  try {
    const result = await reply(req.params.id, text, {
      windowBounds: req.body?.windowBounds || null,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`AOM 已启动: http://127.0.0.1:${port}`);
      resolve({ server, port });
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < PORT + 20) {
        startServer(port + 1).then(resolve, reject);
        return;
      }
      reject(err);
    });
  });
}

const thisFile = path.normalize(fileURLToPath(import.meta.url));
const invokedAsScript =
  process.argv[1] && path.normalize(path.resolve(process.argv[1])) === thisFile;

if (invokedAsScript) {
  const { server } = await startServer();
  async function shutdown() {
    console.log('正在关闭...');
    await closeAll();
    server.close(() => process.exit(0));
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
