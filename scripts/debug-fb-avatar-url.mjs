import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getContext, closeContext } from '../src/browser/manager.js';
import { avatarsDir } from '../src/browser/avatars.js';
import db from '../src/db.js';

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
}

const account = db.prepare(`SELECT id, username FROM accounts WHERE platform='facebook' LIMIT 1`).get();
const peers = db
  .prepare(
    `SELECT peer_nickname, peer_avatar FROM conversations WHERE account_id=? AND peer_avatar IS NOT NULL LIMIT 20`
  )
  .all(account.id);

const selfPath = path.join(avatarsDir, 'd1be21d5e388840e0978.jpg');
const selfBuf = fs.readFileSync(selfPath);
console.log('self', { size: selfBuf.length, sha: sha1(selfBuf) });

for (const p of peers) {
  const rel = String(p.peer_avatar || '').replace('/media/avatars/', '');
  const fp = path.join(avatarsDir, rel);
  if (!fs.existsSync(fp)) continue;
  const buf = fs.readFileSync(fp);
  const same = sha1(buf) === sha1(selfBuf) || buf.equals(selfBuf);
  console.log('peer', p.peer_nickname, { size: buf.length, sha: sha1(buf), sameFile: same, path: rel });
}

const context = await getContext(account.id, { headless: true });
const page = context.pages()[0] || (await context.newPage());

// 个人页 og:image
const profileUrl = `https://www.facebook.com/profile.php?id=${account.username}`;
await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.log('goto profile', e.message));
await page.waitForTimeout(3000);
const meta = await page.evaluate(() => {
  const og = document.querySelector('meta[property="og:image"]')?.content || null;
  const title = document.title;
  const h1 = document.querySelector('h1')?.innerText || null;
  const imgs = [...document.querySelectorAll('image, img')]
    .map((el) => el.getAttribute('xlink:href') || el.getAttribute('href') || el.currentSrc || el.src)
    .filter((u) => u && /scontent|fbcdn/i.test(u))
    .slice(0, 8);
  return { og, title, h1, imgs };
});
console.log('profile page', {
  title: meta.title,
  h1: meta.h1,
  og: meta.og?.slice(0, 160),
  imgs: meta.imgs.map((u) => u.slice(0, 120)),
});

if (meta.og) {
  try {
    const u = new URL(meta.og);
    if (u.searchParams.has('ctp')) u.searchParams.set('ctp', 's320x320');
    const tab = await context.newPage();
    const res = await tab.goto(u.toString(), { waitUntil: 'load', timeout: 20000 });
    const buf = Buffer.from(await res.body());
    console.log('og download', res.status(), buf.length, sha1(buf), 'sameAsSelf', sha1(buf) === sha1(selfBuf));
    fs.writeFileSync(path.join(avatarsDir, 'from-og.jpg'), buf);
    await tab.close();
  } catch (e) {
    console.log('og fail', e.message.split('\n')[0]);
  }
}

await closeContext(account.id);
