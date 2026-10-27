import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, 'dist-stage');
const appServer = path.join(stage, 'app-server');
const iconDir = path.join(root, 'build');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: opts.env || process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} 失败`);
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function emptyDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

if (!fs.existsSync(path.join(iconDir, 'icon.ico'))) {
  throw new Error('缺少 build/icon.ico');
}

emptyDir(stage);
emptyDir(appServer);
copyDir(path.join(root, 'src'), path.join(appServer, 'src'));
copyDir(path.join(root, 'public'), path.join(appServer, 'public'));

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
delete pkg.devDependencies;
delete pkg.build;
delete pkg.main;
pkg.scripts = { start: 'node src/server.js' };
fs.writeFileSync(path.join(appServer, 'package.json'), JSON.stringify(pkg, null, 2));

console.log('正在安装运行依赖（不含内置浏览器）…');
run(npmCmd, ['install', '--omit=dev'], {
  cwd: appServer,
  env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
});

const builderCli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
if (!fs.existsSync(builderCli)) {
  console.log('正在安装打包工具…');
  run(npmCmd, ['install']);
}

console.log('正在生成 AOM.exe…');
run(process.execPath, [builderCli, '--win', 'portable']);

const distDir = path.join(root, 'dist');
const keep = new Set(['AOM.exe']);
for (const name of fs.readdirSync(distDir)) {
  if (keep.has(name)) continue;
  fs.rmSync(path.join(distDir, name), { recursive: true, force: true });
}
