import { app, BrowserWindow, Menu } from 'electron';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

app.setName('AOM');
app.setAppUserModelId('local.aom.app');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('node:child_process').ChildProcess | null} */
let serverProcess = null;
let quitting = false;

function packagedPaths() {
  if (app.isPackaged) {
    return {
      serverRoot: path.join(process.resourcesPath, 'app-server'),
      dataDir: path.join(app.getPath('userData'), 'data'),
    };
  }
  return {
    serverRoot: projectRoot,
    dataDir: path.join(projectRoot, 'data'),
  };
}

function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForHealth(timeoutMs = 30000) {
  const started = Date.now();
  const ports = Array.from({ length: 21 }, (_, i) => 3788 + i);
  while (Date.now() - started < timeoutMs) {
    for (const port of ports) {
      if (await checkHealth(port)) return port;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('服务启动超时');
}

function startBackend() {
  const { serverRoot, dataDir } = packagedPaths();
  const env = {
    ...process.env,
    PORT: process.env.PORT || '3788',
    TTC_DATA_DIR: dataDir,
    ELECTRON_RUN_AS_NODE: '1',
  };
  delete env.PLAYWRIGHT_BROWSERS_PATH;

  serverProcess = spawn(process.execPath, [path.join(serverRoot, 'src', 'server.js')], {
    cwd: serverRoot,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  serverProcess.on('error', (err) => {
    console.error('无法启动后台服务:', err);
  });
}

function stopBackend() {
  if (!serverProcess || serverProcess.killed) return;
  const pid = serverProcess.pid;
  serverProcess = null;
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* ignore */
  }
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'AOM',
    icon: path.join(projectRoot, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#111111',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  startBackend();
  const port = await waitForHealth();
  createWindow(port);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (quitting) return;
  quitting = true;
  stopBackend();
});
