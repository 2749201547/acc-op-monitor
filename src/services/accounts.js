import { v4 as uuid } from 'uuid';
import db, { profilePath } from '../db.js';
import { startQrLogin, getLoginStatus, cancelLogin } from '../browser/login.js';
import { closeContext } from '../browser/manager.js';
import fs from 'fs';

function now() {
  return new Date().toISOString();
}

export function listAccounts() {
  return db
    .prepare(
      `SELECT id, label, username, display_name as displayName, avatar_url as avatarUrl,
              status, last_sync_at as lastSyncAt, created_at as createdAt, updated_at as updatedAt
       FROM accounts ORDER BY created_at DESC`
    )
    .all();
}

export function createAccount(label) {
  const id = uuid();
  const t = now();
  db.prepare(
    `INSERT INTO accounts (id, label, status, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?)`
  ).run(id, label || '未命名账号', t, t);
  return getAccount(id);
}

export function getAccount(id) {
  return db
    .prepare(
      `SELECT id, label, username, display_name as displayName, avatar_url as avatarUrl,
              status, last_sync_at as lastSyncAt, created_at as createdAt, updated_at as updatedAt
       FROM accounts WHERE id = ?`
    )
    .get(id);
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
  db.prepare(
    `UPDATE accounts SET label=?, username=?, display_name=?, avatar_url=?, status=?,
     last_sync_at=?, updated_at=? WHERE id=?`
  ).run(label, username, displayName, avatarUrl, status, lastSyncAt, now(), id);
  return getAccount(id);
}

export function beginLogin(accountId) {
  const a = getAccount(accountId);
  if (!a) throw new Error('账号不存在');
  updateAccount(accountId, { status: 'logging_in' });
  // 立刻返回，浏览器在后台启动，避免管理台卡住
  return startQrLogin(accountId);
}

export async function pollLogin(accountId) {
  const a = getAccount(accountId);
  if (!a) throw new Error('账号不存在');
  const result = await getLoginStatus(accountId);
  if (result.status === 'logged_in') {
    updateAccount(accountId, {
      status: 'active',
      username: result.profile?.username,
      displayName: result.profile?.displayName,
      avatarUrl: result.profile?.avatarUrl,
    });
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
