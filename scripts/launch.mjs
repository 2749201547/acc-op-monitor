import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSystemBrowser } from '../src/browser/system-browser.js';

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
    (existsSync(path.join(projectRoot, 'node_modules', 'playwright-core')) ||
      existsSync(path.join(projectRoot, 'node_modules', 'playwright')))
  );
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

  if (!findSystemBrowser()) {
    console.error('未找到 Chrome 或 Edge。登录需要其中之一，请先安装后再打开。');
    process.exit(1);
  }
}

function waitForHealth(timeoutMs = 20000) {
  const started = Date.now();
  const ports = Array.from({ length: 21 }, (_, i) => PORT + i);
  return new Promise((resolve) => {
    const ping = () => {
      const tryPort = (index) => {
        if (index >= ports.length) {
          if (Date.now() - started > timeoutMs) {
            resolve(false);
            return;
          }
          setTimeout(ping, 300);
          return;
        }
        const req = http.get(`http://127.0.0.1:${ports[index]}/api/health`, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        });
        req.on('error', () => tryPort(index + 1));
        req.setTimeout(400, () => {
          req.destroy();
          tryPort(index + 1);
        });
      };
      tryPort(0);
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
