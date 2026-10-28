import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDataDir } from '../src/paths.js';

const db = new DatabaseSync(path.join(getDataDir(), 'app.db'));
const acc = db
  .prepare(
    `SELECT id, username, display_name, avatar_url FROM accounts WHERE platform='facebook' LIMIT 1`
  )
  .get();
console.log('account', acc);

if (acc?.id) {
  const key = `account_${acc.id}`;
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 20);
  const dir = path.join(getDataDir(), 'avatars');
  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    const p = path.join(dir, `${hash}.${ext}`);
    if (fs.existsSync(p)) {
      console.log('cache file', p, 'size', fs.statSync(p).size);
    }
  }
  if (acc.avatar_url?.startsWith('/media/')) {
    const p = path.join(getDataDir(), acc.avatar_url.replace('/media/', ''));
    console.log('avatar path', p, 'exists', fs.existsSync(p), fs.existsSync(p) ? fs.statSync(p).size : null);
  }
}
