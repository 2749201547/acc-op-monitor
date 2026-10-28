/**
 * 刷新 Facebook 账号头像（放大 ctp 后 goto 下载）
 */
import { getContext, closeContext, readProfile } from '../src/browser/manager.js';
import { updateAccount, getAccount } from '../src/services/accounts.js';
import db from '../src/db.js';

const account = db
  .prepare(`SELECT id, display_name FROM accounts WHERE platform='facebook' LIMIT 1`)
  .get();
if (!account) {
  console.error('没有 Facebook 账号');
  process.exit(1);
}

if (/^\d+$/.test(String(account.display_name || ''))) {
  db.prepare(`UPDATE accounts SET display_name = ? WHERE id = ?`).run('Grace Lin', account.id);
}

console.log('before', getAccount(account.id));

const context = await getContext(account.id, { headless: true });
try {
  const page = context.pages()[0] || (await context.newPage());
  await page
    .goto('https://www.facebook.com/messages/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    })
    .catch(() => null);
  await page.waitForTimeout(3000);

  const profile = await readProfile(context, 'facebook');
  console.log('profile', profile);

  const prev = getAccount(account.id);
  const nextName =
    profile?.displayName && !/^\d{5,}$/.test(String(profile.displayName))
      ? profile.displayName
      : prev.displayName;

  updateAccount(account.id, {
    username: profile?.username || prev.username,
    displayName: nextName,
    avatarUrl: profile?.avatarUrl || prev.avatarUrl,
  });
  console.log('after', getAccount(account.id));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await closeContext(account.id).catch(() => {});
  process.exit(process.exitCode || 0);
}
