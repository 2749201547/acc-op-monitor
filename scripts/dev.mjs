/**
 * 开发模式：打开软件窗口（Electron），改代码能尽快看到效果
 * - 前端 public/* ：在窗口里 Ctrl+R / F5 刷新
 * - 后端 src/*   ：自动重启服务，再 Ctrl+R
 * 便携版打包：npm run dist
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSystemBrowser } from '../src/browser/system-browser.js';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

process.chdir(projectRoot);

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error('需要 Node.js 22+');
  process.exit(1);
}

if (!existsSync(path.join(projectRoot, 'node_modules', 'express'))) {
  console.error('请先执行：npm install');
  process.exit(1);
}

if (!existsSync(path.join(projectRoot, 'node_modules', 'electron'))) {
  console.error('缺少 Electron，请先执行：npm install');
  process.exit(1);
}

if (!findSystemBrowser()) {
  console.error('未找到 Chrome 或 Edge，登录功能需要其中之一。');
  process.exit(1);
}

console.log('AOM 开发模式（软件窗口）');
console.log('  前端改 public/ → 窗口内按 Ctrl+R 或 F5');
console.log('  后端改 src/   → 服务自动重启，再 Ctrl+R');
console.log('  打包便携版    → npm run dist\n');

const child = spawn(npmCmd, ['run', 'electron'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    AOM_DEV: '1',
  },
});

child.on('exit', (code) => process.exit(code ?? 0));
