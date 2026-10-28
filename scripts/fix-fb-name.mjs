/**
 * 从「Your profile」按钮取 src，再下载原图（不截小图标）
 */
import { getContext, closeContext } from '../src/browser/manager.js';
import { updateAccount, getAccount } from '../src/services/accounts.js';
import { cacheAvatar, avatarsDir } from '../src/browser/avatars.js';
import db from '../src/db.js';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';

const account = db
  .prepare(`SELECT id, username, display_name, avatar_url FROM accounts WHERE platform='facebook' LIMIT 1`)
  .get();
console.log('before', account);

const key = `account_${account.id}`;
const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 20);
for (const h of [hash, crypto.createHash('sha1').update('account_profile').digest('hex').slice(0, 20)]) {
  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    const p = path.join(avatarsDir, `${h}.${ext}`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
if (account.avatar_url?.startsWith('/media/avatars/')) {
  const p = path.join(avatarsDir, path.basename(account.avatar_url));
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

const timer = setTimeout(async () => {
  console.error('硬超时');
  await closeContext(account.id).catch(() => {});
  process.exit(2);
}, 45000);

const context = await getContext(account.id, { headless: true });
const page = context.pages()[0] || (await context.newPage());

try {
  await page.goto('https://www.facebook.com/messages/', {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  await page.waitForTimeout(2000);

  const src = await page.evaluate(() => {
    const btns = [
      ...document.querySelectorAll(
        '[aria-label="Your profile"], [aria-label="Account, your profile"], [aria-label^="Your profile"]'
      ),
    ];
    for (const btn of btns) {
      const img = btn.querySelector('image, img');
      if (!img) continue;
      const u =
        img.getAttribute('xlink:href') ||
        img.getAttribute('href') ||
        img.currentSrc ||
        img.src ||
        '';
      if (/scontent|fbcdn/i.test(u) && !/rsrc\.php/i.test(u)) return u;
    }
    return null;
  });

  console.log('self avatar src', String(src || '').slice(0, 160));
  if (!src) throw new Error('no self avatar src');

  // 去掉尺寸限制参数，尽量要大图
  const big = src.replace(/stp=[^&]+&?/i, '').replace(/&&/g, '&');
  console.log('download…');
  const avatarUrl = await cacheAvatar(context, big, key);
  if (!avatarUrl) throw new Error('cacheAvatar failed');

  updateAccount(account.id, {
    displayName: account.display_name || 'Grace Lin',
    avatarUrl,
  });
  console.log('after', getAccount(account.id));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await closeContext(account.id).catch(() => {});
  process.exit(process.exitCode || 0);
}
