import fs from 'fs';
import path from 'path';
import { getContext, closeContext } from '../src/browser/manager.js';
import { syncMessages, isLoggedIn, readProfile } from '../src/browser/platforms/facebook.js';
import db from '../src/db.js';
import { getDataDir } from '../src/paths.js';

const account = db.prepare(`SELECT * FROM accounts WHERE platform='facebook' LIMIT 1`).get();
if (!account) throw new Error('no fb account');
console.log('account', account.id, account.username);

const outDir = path.join(getDataDir(), 'debug-fb');
fs.mkdirSync(outDir, { recursive: true });

await closeContext(account.id);
const context = await getContext(account.id, { headless: false });
console.log('loggedIn?', await isLoggedIn(context));

const page = context.pages()[0] || (await context.newPage());

async function dump(label) {
  const info = await page.evaluate(() => {
    const allA = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') || '');
    const tLinks = allA.filter((h) => /\/t\/|messages|thread|chat/i.test(h));
    return {
      url: location.href,
      title: document.title,
      tLinks: tLinks.slice(0, 40),
      tCount: tLinks.length,
      body: (document.body?.innerText || '').slice(0, 600),
      imgCount: document.querySelectorAll('img').length,
      roleRows: document.querySelectorAll('[role="row"]').length,
      roleList: document.querySelectorAll('[role="listitem"]').length,
      roleGrid: document.querySelectorAll('[role="grid"], [role="gridcell"]').length,
    };
  });
  console.log('\n[' + label + ']', JSON.stringify(info, null, 2));
  const shot = path.join(outDir, `${label}.jpg`);
  await page.screenshot({ path: shot, type: 'jpeg', quality: 55 }).catch(() => {});
  console.log('shot', shot);
  return info;
}

for (const url of [
  'https://www.facebook.com/messages/',
  'https://www.facebook.com/messages/t/',
  'https://www.messenger.com/',
  'https://www.messenger.com/chats',
]) {
  console.log('\n>> goto', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) =>
    console.log('goto err', e.message)
  );
  await page.waitForTimeout(4000);
  const info = await dump(url.replace(/https?:\/\//, '').replace(/[\/:?]/g, '_'));
  if (info.tCount > 0) break;
}

console.log('\n>> readProfile');
const profile = await readProfile(context);
console.log('profile', profile);

console.log('\n>> syncMessages');
const result = await syncMessages(context, account.id);
console.log(
  JSON.stringify(
    {
      ok: result.ok,
      reason: result.reason,
      conv: result.conversations?.length,
      msg: result.messages?.length,
      sample: result.conversations?.slice(0, 5),
      profile: result.profile,
    },
    null,
    2
  )
);

fs.writeFileSync(path.join(outDir, 'sync-result.json'), JSON.stringify(result, null, 2));
await closeContext(account.id);
console.log('done');
process.exit(0);
