import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { getContext, closeAll, readProfile } from '../src/browser/manager.js';
import { cacheAvatar } from '../src/browser/avatars.js';
import { avatarsDir } from '../src/browser/avatars.js';

const db = new DatabaseSync('data/app.db');
const a = db.prepare('select id, username, display_name, avatar_url from accounts').get();
if (!a) {
  console.log('no account');
  process.exit(1);
}

const ctx = await getContext(a.id, { headless: true });
const page = ctx.pages()[0] || (await ctx.newPage());

// 打开个人页拿更大更稳的头像
const uname = a.username;
if (uname) {
  await page.goto(`https://www.tiktok.com/@${uname}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
} else {
  await page.goto('https://www.tiktok.com/foryou', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
}
await page.waitForTimeout(3500);

const profile = await readProfile(ctx);
console.log('profile', profile);

let remote =
  profile?.avatarUrl ||
  (await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')];
    for (const img of imgs) {
      const src = img.currentSrc || img.src || '';
      if (/avatar|avt-|tiktokcdn|bytedance/i.test(src) && src.startsWith('http')) {
        return src;
      }
    }
    return null;
  }));

console.log('remote', remote?.slice?.(0, 120));

if (remote) {
  // 强制重下：删掉旧缓存
  for (const f of fs.readdirSync(avatarsDir)) {
    if (f.startsWith('account_') || f.includes(a.id.slice(0, 8))) {
      fs.unlinkSync(path.join(avatarsDir, f));
    }
  }
  const manual = path.join(avatarsDir, 'account_manual.jpg');
  if (fs.existsSync(manual)) fs.unlinkSync(manual);

  const local = await cacheAvatar(ctx, remote, `account_${a.id}_v2`);
  console.log('local', local, 'exists', local && fs.existsSync(path.join('data', local.replace(/^\//, '').replace(/^media\//, 'media/').replace(/^media\//, ''))));

  // resolve file path
  if (local?.startsWith('/media/')) {
    const fp = path.join('data', local.slice('/media/'.length));
    console.log('file', fp, fs.existsSync(fp) ? fs.statSync(fp).size : 0);
    db.prepare(
      `update accounts set avatar_url=?, username=COALESCE(?, username),
       display_name=COALESCE(?, display_name), updated_at=? where id=?`
    ).run(
      local,
      profile?.username || null,
      profile?.displayName || null,
      new Date().toISOString(),
      a.id
    );
  }
}

console.log('final', db.prepare('select username, display_name, avatar_url from accounts').get());
await closeAll();
process.exit(0);
