import { getContext, closeContext } from '../src/browser/manager.js';
import db from '../src/db.js';

const account = db
  .prepare(
    `SELECT id, username, display_name, avatar_url, status FROM accounts WHERE platform='facebook' LIMIT 1`
  )
  .get();
console.log('db account', account);

const context = await getContext(account.id, { headless: true });
try {
  const cookies = await context.cookies();
  const cUser = cookies.find((c) => c.name === 'c_user');
  const xs = cookies.find((c) => c.name === 'xs');
  console.log('cookie c_user', cUser?.value || null);
  console.log('cookie xs present', !!xs?.value);
  console.log('match username===c_user', String(account.username) === String(cUser?.value));

  // 再看个人页 URL / 标题是否对得上
  const page = context.pages()[0] || (await context.newPage());
  await page
    .goto(`https://www.facebook.com/profile.php?id=${account.username}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    })
    .catch(() => null);
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => {
    const h1 = document.querySelector('h1')?.innerText?.trim() || null;
    const title = document.title;
    const url = location.href;
    return { h1, title, url };
  });
  console.log('profile page', info);
} finally {
  await closeContext(account.id).catch(() => {});
}
