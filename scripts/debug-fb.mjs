/**
 * One-off debug: open FB account profile and dump inbox/avatar signals.
 * Usage: node scripts/debug-fb.mjs
 */
import { getContext, closeContext } from '../src/browser/manager.js';
import db from '../src/db.js';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../src/paths.js';

const account = db.prepare(`SELECT * FROM accounts WHERE platform='facebook' LIMIT 1`).get();
if (!account) {
  console.error('no facebook account');
  process.exit(1);
}
console.log('account', {
  id: account.id,
  username: account.username,
  display_name: account.display_name,
  avatar_url: account.avatar_url,
});

const outDir = path.join(getDataDir(), 'debug-fb');
fs.mkdirSync(outDir, { recursive: true });

const context = await getContext(account.id, { headless: false });
const page = context.pages()[0] || (await context.newPage());

const cookies = await context.cookies();
const interesting = cookies.filter((c) =>
  ['c_user', 'xs', 'datr', 'sb', 'fr'].includes(c.name)
);
console.log(
  'cookies',
  interesting.map((c) => ({ name: c.name, domain: c.domain, val: String(c.value).slice(0, 12) }))
);

const cUser = cookies.find((c) => c.name === 'c_user')?.value;
console.log('c_user', cUser);

// Graph picture
if (cUser) {
  const url = `https://graph.facebook.com/${cUser}/picture?type=large`;
  try {
    const res = await context.request.get(url, { maxRedirects: 10 });
    const buf = Buffer.from(await res.body());
    const ct = res.headers()['content-type'];
    const file = path.join(outDir, 'graph-avatar.bin');
    fs.writeFileSync(file, buf);
    console.log('graph avatar', { status: res.status(), ct, size: buf.length, file });
  } catch (e) {
    console.log('graph fail', e.message);
  }
}

const urls = [
  'https://www.messenger.com/chats',
  'https://www.facebook.com/messages/',
  'https://www.messenger.com/',
];

for (const url of urls) {
  console.log('\n=== goto', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => {
    console.log('goto err', e.message);
  });
  await page.waitForTimeout(3000);
  const finalUrl = page.url();
  const title = await page.title();
  const threadCount = await page.locator('a[href*="/t/"]').count();
  const info = await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href*="/t/"]')].slice(0, 15).map((a) => ({
      href: a.getAttribute('href'),
      text: (a.innerText || '').trim().slice(0, 80),
      imgs: [...a.querySelectorAll('img')].map((i) => (i.currentSrc || i.src || '').slice(0, 120)),
    }));
    const h1s = [...document.querySelectorAll('h1')].map((h) => (h.innerText || '').trim().slice(0, 80));
    const bodySample = (document.body?.innerText || '').slice(0, 400);
    return { links, h1s, bodySample };
  });
  console.log({ finalUrl, title, threadCount, h1s: info.h1s });
  console.log('threads sample', info.links);
  console.log('body sample', info.bodySample.replace(/\n/g, ' | ').slice(0, 300));
  const shot = path.join(outDir, `page-${urls.indexOf(url)}.jpg`);
  await page.screenshot({ path: shot, fullPage: false, type: 'jpeg', quality: 60 });
  console.log('screenshot', shot);
  if (threadCount > 0) break;
}

// profile page name
if (cUser) {
  await page.goto(`https://www.facebook.com/profile.php?id=${cUser}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForTimeout(2500);
  const profileInfo = await page.evaluate(() => ({
    title: document.title,
    h1: [...document.querySelectorAll('h1')].map((h) => (h.innerText || '').trim()),
    url: location.href,
  }));
  console.log('\nprofile page', profileInfo);
  await page.screenshot({
    path: path.join(outDir, 'profile.jpg'),
    type: 'jpeg',
    quality: 60,
  });
}

await closeContext(account.id);
console.log('\ndone');
process.exit(0);
