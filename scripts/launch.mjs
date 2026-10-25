import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3788);
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

process.chdir(projectRoot);

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} 失败`);
  }
}

function hasJsDeps() {
  return (
    existsSync(path.join(projectRoot, 'node_modules', 'express')) &&
    existsSync(path.join(projectRoot, 'node_modules', 'playwright'))
  );
}

function findChrome() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}

async function ensureDeps() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) {
    console.error('需要 Node.js 22 或更高版本。请安装 LTS：https://nodejs.org');
    process.exit(1);
  }

  if (!hasJsDeps()) {
    console.log('首次运行：正在安装依赖，请稍等（只需这一次）…');
    run(npmCmd, ['install']);
  }

  if (findChrome()) return;

  const { chromium } = await import('playwright');
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return;

  console.log('未找到本机 Chrome，正在安装内置浏览器（只需这一次）…');
  run(npmCmd, ['run', 'setup']);
}

function waitForHealth(timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const ping = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(ping, 300);
      });
    };
    ping();
  });
}

function openBrowser() {
  const url = `http://localhost:${PORT}`;
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

await ensureDeps();

const child = spawn(process.execPath, [path.join(projectRoot, 'src', 'server.js')], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));

if (await waitForHealth()) {
  openBrowser();
}
