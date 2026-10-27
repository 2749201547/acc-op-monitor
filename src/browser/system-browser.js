import fs from 'fs';
import path from 'path';

function firstExisting(paths) {
  return paths.filter(Boolean).find((p) => fs.existsSync(p)) || null;
}

export function findSystemBrowser() {
  const chromePath =
    process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)
      ? process.env.CHROME_PATH
      : firstExisting([
          process.env.LOCALAPPDATA &&
            path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ]);
  if (chromePath) return { channel: 'chrome', executablePath: chromePath };

  const edgePath = firstExisting([
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ]);
  if (edgePath) return { channel: 'msedge', executablePath: edgePath };

  return null;
}

export function requireSystemBrowser() {
  const browser = findSystemBrowser();
  if (!browser) {
    throw new Error('未找到 Chrome 或 Edge。请先安装其中一个，再重新登录。');
  }
  return browser;
}
