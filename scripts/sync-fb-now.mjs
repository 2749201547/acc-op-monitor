/**
 * 有界面同步 Facebook：若弹出 PIN，请在浏览器里输入正确 PIN。
 */
import { syncOne } from '../src/services/inbox.js';
import { closeAll } from '../src/browser/manager.js';
import db from '../src/db.js';

const account = db.prepare(`SELECT id, username FROM accounts WHERE platform='facebook' LIMIT 1`).get();
if (!account) {
  console.error('没有 Facebook 账号');
  process.exit(1);
}

console.log('开始同步 Facebook:', account.id, account.username);
console.log('若弹出 PIN 窗口，请输入正确 PIN（最多等 3 分钟）…');

try {
  const result = await syncOne(account.id);
  console.log('结果:', JSON.stringify(result, null, 2));
  const conv = db
    .prepare(`SELECT peer_nickname, peer_avatar, last_message FROM conversations WHERE account_id=? LIMIT 15`)
    .all(account.id);
  console.log('会话样本:', conv);
  const acc = db
    .prepare(`SELECT username, display_name, avatar_url FROM accounts WHERE id=?`)
    .get(account.id);
  console.log('账号资料:', acc);
} catch (e) {
  console.error('同步失败:', e);
  process.exitCode = 1;
} finally {
  await closeAll();
  process.exit(process.exitCode || 0);
}
