import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const isDev = process.env.AOM_DEV === '1' || !app.isPackaged;

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

  // 开发模式：监听 src 变更自动重启后端
  const serverArgs =
    isDev && !app.isPackaged
      ? ['--watch', '--watch-path=src', path.join(serverRoot, 'src', 'server.js')]
      : [path.join(serverRoot, 'src', 'server.js')];

  serverProcess = spawn(process.execPath, serverArgs, {
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
  // 隐藏系统标题栏，内容顶到窗口边缘；右上角保留最小化/最大化/关闭
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: isDev && !app.isPackaged ? 'AOM（开发）' : 'AOM',
    icon: path.join(projectRoot, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#f3f4f6',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#4b5563',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev && !app.isPackaged) {
    // 仅在本窗口内：Ctrl+R / F5 刷新；Ctrl+Shift+I 调试
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const ctrl = input.control || input.meta;
      if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r')) {
        event.preventDefault();
        mainWindow.webContents.reloadIgnoringCache();
      } else if (ctrl && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault();
        mainWindow.webContents.toggleDevTools();
      }
    });
  }
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

/**
 * Content-relative CSS rect → screen DIP rect for Chrome CDP setWindowBounds.
 * (CDP uses DIP; do NOT convert with dipToScreenRect or the window drifts on scaled displays.)
 */
ipcMain.handle('aom:slotToScreen', (_event, rect) => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const r = rect || {};
  const x = Number(r.x);
  const y = Number(r.y);
  const width = Number(r.width);
  const height = Number(r.height);
  // x/y may be negative on multi-monitor; only size must be positive
  if (![x, y, width, height].every((n) => Number.isFinite(n)) || width < 1 || height < 1) {
    return null;
  }
  const content = mainWindow.getContentBounds();
  return {
    x: Math.round(content.x + x),
    y: Math.round(content.y + y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
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
