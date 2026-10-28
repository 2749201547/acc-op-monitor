import db from '../src/db.js';
import { syncOne } from '../src/services/inbox.js';
import { closeAll } from '../src/browser/manager.js';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../src/paths.js';

const acc = db.prepare(`SELECT id FROM accounts WHERE platform='facebook' LIMIT 1`).get();
if (!acc) {
  console.error('no facebook account');
  process.exit(1);
}

// 清掉旧的错误会话头像缓存引用，强制按列表重抓
const rows = db
  .prepare(`SELECT peer_avatar FROM conversations WHERE account_id=?`)
  .all(acc.id);
for (const r of rows) {
  if (r.peer_avatar && String(r.peer_avatar).startsWith('/media/avatars/')) {
    const fp = path.join(getDataDir(), r.peer_avatar.replace('/media/', ''));
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      /* ignore */
    }
  }
}
db.prepare(`UPDATE conversations SET peer_avatar=NULL WHERE account_id=?`).run(acc.id);

console.log('重新同步 Facebook（有界面，若出 PIN 请输入）…');
const result = await syncOne(acc.id);
console.log(result);

const list = db
  .prepare(
    `SELECT peer_nickname, last_message_at, substr(peer_avatar,1,48) as av
     FROM conversations WHERE account_id=?
     ORDER BY COALESCE(last_message_at, updated_at) DESC LIMIT 12`
  )
  .all(acc.id);
console.log(list);

await closeAll();
process.exit(result.ok ? 0 : 1);
