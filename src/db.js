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
`);

// 旧库补 platform 列
try {
  const cols = db.prepare('PRAGMA table_info(accounts)').all();
  if (!cols.some((c) => c.name === 'platform')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN platform TEXT NOT NULL DEFAULT 'tiktok'`);
  }
} catch {
  /* ignore */
}

export function profilePath(accountId) {
  return path.join(profilesDir, accountId);
}

export default db;
