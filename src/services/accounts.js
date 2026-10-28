import { v4 as uuid } from 'uuid';
import db, { profilePath } from '../db.js';
import { startQrLogin, getLoginStatus, cancelLogin } from '../browser/login.js';
import { closeContext } from '../browser/manager.js';
import { normalizePlatform, PLATFORMS } from '../browser/platforms/index.js';
import fs from 'fs';

function now() {
  return new Date().toISOString();
}

const ACCOUNT_SELECT = `SELECT id, label, platform, username, display_name as displayName, avatar_url as avatarUrl,
              status, last_sync_at as lastSyncAt, created_at as createdAt, updated_at as updatedAt
       FROM accounts`;

export function listAccounts() {
  return db.prepare(`${ACCOUNT_SELECT} ORDER BY created_at DESC`).all();
}

export function createAccount(label, platform) {
  const id = uuid();
  const t = now();
  const p = normalizePlatform(platform);
  if (!PLATFORMS.includes(p)) {
    throw new Error('不支持的平台');
  }
  db.prepare(
    `INSERT INTO accounts (id, label, platform, status, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`
  ).run(id, label || '未命名账号', p, t, t);
  return getAccount(id);
}

export function getAccount(id) {
  return db.prepare(`${ACCOUNT_SELECT} WHERE id = ?`).get(id);
}

export function updateAccount(id, fields) {
  const a = getAccount(id);
  if (!a) return null;
  const username = fields.username !== undefined ? fields.username : a.username;
  const displayName =
    fields.displayName !== undefined ? fields.displayName : a.displayName;
  const avatarUrl = fields.avatarUrl !== undefined ? fields.avatarUrl : a.avatarUrl;
  const status = fields.status !== undefined ? fields.status : a.status;
  const lastSyncAt = fields.lastSyncAt !== undefined ? fields.lastSyncAt : a.lastSyncAt;
  const label = fields.label !== undefined ? fields.label : a.label;
  const platform = fields.platform !== undefined ? normalizePlatform(fields.platform) : a.platform;
  db.prepare(
    `UPDATE accounts SET label=?, platform=?, username=?, display_name=?, avatar_url=?, status=?,
     last_sync_at=?, updated_at=? WHERE id=?`
  ).run(label, platform, username, displayName, avatarUrl, status, lastSyncAt, now(), id);
  return getAccount(id);
}

export function beginLogin(accountId, windowBounds = null) {
  const a = getAccount(accountId);
  if (!a) throw new Error('账号不存在');
  updateAccount(accountId, { status: 'logging_in' });
  return startQrLogin(accountId, a.platform, windowBounds);
}

export async function pollLogin(accountId) {
  const a = getAccount(accountId);
  if (!a) throw new Error('账号不存在');
  const result = await getLoginStatus(accountId);
  if (result.status === 'logged_in') {
    const patch = {
      status: 'active',
      username: result.profile?.username,
      displayName: result.profile?.displayName,
    };
    // 登录快路径常拿不到头像；不要用 null 把已有头像覆盖掉
    if (result.profile?.avatarUrl) {
      patch.avatarUrl = result.profile.avatarUrl;
    }
    updateAccount(accountId, patch);
  } else if (result.status === 'expired' || result.status === 'error') {
    updateAccount(accountId, { status: result.status === 'error' ? 'pending' : 'expired' });
  }
  return { ...result, account: getAccount(accountId) };
}

export async function stopLogin(accountId) {
  await cancelLogin(accountId);
  const a = getAccount(accountId);
  if (a && a.status === 'logging_in') {
    updateAccount(accountId, { status: 'pending' });
  }
}

export async function removeAccount(accountId) {
  await cancelLogin(accountId);
  await closeContext(accountId);
  db.prepare('DELETE FROM messages WHERE account_id = ?').run(accountId);
  db.prepare('DELETE FROM conversations WHERE account_id = ?').run(accountId);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  const dir = profilePath(accountId);
  fs.rmSync(dir, { recursive: true, force: true });
}
