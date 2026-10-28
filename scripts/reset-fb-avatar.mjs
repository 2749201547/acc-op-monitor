import db from '../src/db.js';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../src/paths.js';

const p = path.join(getDataDir(), 'avatars', 'a471324b9fd4f90c4799.jpg');
if (fs.existsSync(p)) fs.unlinkSync(p);

db.prepare(
  `UPDATE accounts SET display_name = username, avatar_url = NULL WHERE platform = 'facebook'`
).run();

console.log(
  db.prepare(`SELECT id, username, display_name, avatar_url FROM accounts WHERE platform = 'facebook'`).get()
);
