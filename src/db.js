import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { getDataDir } from './paths.js';

const dataDir = getDataDir();
const profilesDir = path.join(dataDir, 'profiles');

const db = new DatabaseSync(path.join(dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'tiktok',
    username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_sync_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    peer_username TEXT,
    peer_nickname TEXT,
    peer_avatar TEXT,
    last_message TEXT,
    last_message_at TEXT,
    unread INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    UNIQUE(account_id, peer_id),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    content TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    sent_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(account_id, id),
    FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, sent_at);

  CREATE TABLE IF NOT EXISTS proxy_regions (
    name TEXT PRIMARY KEY,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS proxy_profiles (
    id TEXT PRIMARY KEY,
    region TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    server TEXT NOT NULL,
    username TEXT,
    password TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(region) REFERENCES proxy_regions(name) ON UPDATE CASCADE ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_proxy_profiles_region ON proxy_profiles(region, created_at);
`);

// 旧库补列
try {
  const cols = db.prepare('PRAGMA table_info(accounts)').all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('platform')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN platform TEXT NOT NULL DEFAULT 'tiktok'`);
  }
  if (!names.has('proxy_server')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN proxy_server TEXT`);
  }
  if (!names.has('proxy_username')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN proxy_username TEXT`);
  }
  if (!names.has('proxy_password')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN proxy_password TEXT`);
  }
  if (!names.has('proxy_region')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN proxy_region TEXT`);
  }
  if (!names.has('proxy_profile_id')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN proxy_profile_id TEXT`);
  }
} catch {
  /* ignore */
}

// 默认国家分组（可自行增删）
try {
  const count = db.prepare('SELECT COUNT(*) AS c FROM proxy_regions').get()?.c || 0;
  if (count === 0) {
    const t = new Date().toISOString();
    const seed = [
      ['美国', 10],
      ['马来', 20],
      ['泰国', 30],
      ['新加坡', 40],
      ['菲律宾', 50],
    ];
    const ins = db.prepare(
      'INSERT OR IGNORE INTO proxy_regions (name, sort_order, created_at) VALUES (?, ?, ?)'
    );
    for (const [name, order] of seed) ins.run(name, order, t);
  }
} catch {
  /* ignore */
}

export function profilePath(accountId) {
  return path.join(profilesDir, accountId);
}

export default db;
