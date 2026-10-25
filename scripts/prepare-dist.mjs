import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, 'dist-stage');
const runtimeDir = path.join(stage, 'runtime');
const appServer = path.join(stage, 'app-server');
const browsersDir = path.join(stage, 'pw-browsers');
const toolsDir = path.join(root, 'tools');
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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'tiktokchat-packager' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchJson(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`下载失败 ${url}: ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const go = (u) => {
      https
        .get(u, { headers: { 'User-Agent': 'tiktokchat-packager' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            file.close();
            fs.unlinkSync(dest);
            download(res.headers.location, dest).then(resolve, reject);
            return;
          }
          if (res.statusCode !== 200) {
            file.close();
            fs.unlinkSync(dest);
            reject(new Error(`下载失败 ${u}: ${res.statusCode}`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
        })
        .on('error', (err) => {
          file.close();
          fs.rmSync(dest, { force: true });
          reject(err);
        });
    };
    go(url);
  });
}

function crc32(buf) {
  let crc = ~0;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function writeIconPng(filePath, size = 256) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4;
      const dx = x / size - 0.5;
      const dy = y / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < 0.46) {
        raw[i] = dx < 0 ? 0x69 : 0xee;
        raw[i + 1] = dx < 0 ? 0xc9 : 0x1d;
        raw[i + 2] = dx < 0 ? 0xd0 : 0x52;
        raw[i + 3] = 255;
      } else {
        raw[i] = 0x11;
        raw[i + 1] = 0x11;
        raw[i + 2] = 0x11;
        raw[i + 3] = 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  fs.writeFileSync(
    filePath,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', zlib.deflateSync(raw)),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
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

async function ensureNodeRuntime() {
  fs.mkdirSync(toolsDir, { recursive: true });
  const index = await fetchJson('https://nodejs.org/dist/index.json');
  const lts = index.find((item) => item.lts && item.version.startsWith('v22.')) || index.find((item) => item.lts);
  if (!lts) throw new Error('找不到 Node LTS 版本信息');
  const version = lts.version;
  const zipName = `node-${version}-win-x64.zip`;
  const zipPath = path.join(toolsDir, zipName);
  const extractDir = path.join(toolsDir, `node-${version}-win-x64`);
  const nodeExe = path.join(extractDir, 'node.exe');
  if (!fs.existsSync(nodeExe)) {
    if (!fs.existsSync(zipPath)) {
      console.log(`正在下载便携 Node ${version}…`);
      await download(`https://nodejs.org/dist/${version}/${zipName}`, zipPath);
    }
    console.log('正在解压 Node…');
    run('tar', ['-xf', zipPath, '-C', toolsDir]);
  }
  if (!fs.existsSync(nodeExe)) {
    throw new Error(`未找到 ${nodeExe}`);
  }
  return { version, extractDir, nodeExe };
}

const { extractDir, nodeExe } = await ensureNodeRuntime();
const npmCli = path.join(extractDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');

fs.mkdirSync(iconDir, { recursive: true });
writeIconPng(path.join(iconDir, 'icon.png'));

emptyDir(stage);
fs.mkdirSync(runtimeDir, { recursive: true });
fs.copyFileSync(nodeExe, path.join(runtimeDir, 'node.exe'));

emptyDir(appServer);
copyDir(path.join(root, 'src'), path.join(appServer, 'src'));
copyDir(path.join(root, 'public'), path.join(appServer, 'public'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
delete pkg.devDependencies;
delete pkg.build;
delete pkg.main;
pkg.scripts = { start: 'node src/server.js' };
fs.writeFileSync(path.join(appServer, 'package.json'), JSON.stringify(pkg, null, 2));

const portableEnv = {
  ...process.env,
  PATH: `${extractDir}${path.delimiter}${process.env.PATH}`,
};

console.log('正在用便携 Node 安装运行依赖…');
run(nodeExe, [npmCli, 'install', '--omit=dev'], { cwd: appServer, env: portableEnv });

emptyDir(browsersDir);
console.log('正在安装内置 Chromium（写入安装包）…');
run(nodeExe, [path.join(appServer, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium'], {
  cwd: appServer,
  env: { ...portableEnv, PLAYWRIGHT_BROWSERS_PATH: browsersDir },
});

const builderCli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
if (!fs.existsSync(builderCli)) {
  console.log('正在安装打包工具…');
  run(npmCmd, ['install']);
}

console.log('正在生成安装包和便携版 exe…');
run(process.execPath, [builderCli, '--win', 'nsis', 'portable']);
