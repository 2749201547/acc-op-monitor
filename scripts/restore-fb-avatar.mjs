/**
 * 恢复 Grace Lin 等 Facebook 账号丢失的本地头像文件
 */
import { getContext, closeContext } from '../src/browser/manager.js';
import { updateAccount, getAccount } from '../src/services/accounts.js';
import db from '../src/db.js';

const rows = db
  .prepare(`SELECT id, display_name, username, avatar_url FROM accounts WHERE platform='facebook'`)
  .all();

for (const account of rows) {
  console.log('\n===', account.display_name || account.username, account.id);
  const context = await getContext(account.id, { headless: true });
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page
      .goto('https://www.facebook.com/messages/', {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      })
      .catch(() => null);
    await page.waitForTimeout(2500);

    const { readProfile } = await import('../src/browser/manager.js');
    const profile = await readProfile(context, 'facebook', {
      fast: false,
      accountId: account.id,
    });
    console.log('profile', profile);

    const prev = getAccount(account.id);
    updateAccount(account.id, {
      username: profile?.username || prev.username,
      displayName:
        profile?.displayName && !/^\d{5,}$/.test(String(profile.displayName))
          ? profile.displayName
          : prev.displayName,
      avatarUrl: profile?.avatarUrl || prev.avatarUrl,
    });
    console.log('after', getAccount(account.id));
  } catch (e) {
    console.error(e);
  } finally {
    await closeContext(account.id).catch(() => {});
  }
}
