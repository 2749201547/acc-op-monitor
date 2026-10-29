import { v4 as uuid } from 'uuid';
import db from '../db.js';

function now() {
  return new Date().toISOString();
}

function assertServer(server) {
  const s = String(server || '').trim();
  if (!s) throw new Error('请填写代理地址');
  if (!/^(https?|socks5):\/\//i.test(s)) {
    throw new Error('代理地址须以 http://、https:// 或 socks5:// 开头');
  }
  return s;
}

const REGION_SELECT = `SELECT name, sort_order as sortOrder, created_at as createdAt FROM proxy_regions`;
const PROFILE_SELECT = `SELECT id, region, label, server, username, password,
  created_at as createdAt, updated_at as updatedAt FROM proxy_profiles`;

export function listProxyRegions() {
  return db.prepare(`${REGION_SELECT} ORDER BY sort_order ASC, name ASC`).all();
}

export function createProxyRegion(name) {
  const n = String(name || '').trim().slice(0, 40);
  if (!n) throw new Error('请输入国家/地区名称');
  const existing = db.prepare('SELECT name FROM proxy_regions WHERE name = ?').get(n);
  if (existing) throw new Error('该国家/地区已存在');
  const max =
    db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM proxy_regions').get()?.m || 0;
  db.prepare('INSERT INTO proxy_regions (name, sort_order, created_at) VALUES (?, ?, ?)').run(
    n,
    max + 10,
    now()
  );
  return db.prepare(`${REGION_SELECT} WHERE name = ?`).get(n);
}

export function renameProxyRegion(oldName, newName) {
  const from = String(oldName || '').trim();
  const to = String(newName || '').trim().slice(0, 40);
  if (!from) throw new Error('原名称无效');
  if (!to) throw new Error('请输入新名称');
  const row = db.prepare('SELECT name FROM proxy_regions WHERE name = ?').get(from);
  if (!row) throw new Error('国家/地区不存在');
  if (from !== to) {
    const clash = db.prepare('SELECT name FROM proxy_regions WHERE name = ?').get(to);
    if (clash) throw new Error('目标名称已存在');
    db.prepare('UPDATE proxy_regions SET name = ? WHERE name = ?').run(to, from);
    db.prepare('UPDATE proxy_profiles SET region = ? WHERE region = ?').run(to, from);
    db.prepare('UPDATE accounts SET proxy_region = ? WHERE proxy_region = ?').run(to, from);
  }
  return db.prepare(`${REGION_SELECT} WHERE name = ?`).get(to);
}

export function deleteProxyRegion(name) {
  const n = String(name || '').trim();
  if (!n) throw new Error('名称无效');
  const profiles = db.prepare('SELECT COUNT(*) AS c FROM proxy_profiles WHERE region = ?').get(n);
  if ((profiles?.c || 0) > 0) {
    throw new Error('请先删除该地区下的全部代理');
  }
  db.prepare('DELETE FROM proxy_regions WHERE name = ?').run(n);
  return { ok: true };
}

export function listProxyProfiles(region = null) {
  if (region) {
    return db
      .prepare(`${PROFILE_SELECT} WHERE region = ? ORDER BY created_at DESC`)
      .all(String(region));
  }
  return db.prepare(`${PROFILE_SELECT} ORDER BY region ASC, created_at DESC`).all();
}

export function getProxyProfile(id) {
  return db.prepare(`${PROFILE_SELECT} WHERE id = ?`).get(id);
}

export function createProxyProfile({ region, label, server, username, password }) {
  const regionName = String(region || '').trim();
  if (!regionName) throw new Error('请选择国家/地区');
  const reg = db.prepare('SELECT name FROM proxy_regions WHERE name = ?').get(regionName);
  if (!reg) throw new Error('国家/地区不存在，请先添加');
  const srv = assertServer(server);
  const id = uuid();
  const t = now();
  db.prepare(
    `INSERT INTO proxy_profiles (id, region, label, server, username, password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    regionName,
    String(label || '').trim().slice(0, 80),
    srv,
    String(username || '').trim() || null,
    password != null && String(password) !== '' ? String(password) : null,
    t,
    t
  );
  return getProxyProfile(id);
}

export function updateProxyProfile(id, fields = {}) {
  const cur = getProxyProfile(id);
  if (!cur) throw new Error('代理不存在');
  let region = cur.region;
  if (fields.region !== undefined) {
    region = String(fields.region || '').trim();
    const reg = db.prepare('SELECT name FROM proxy_regions WHERE name = ?').get(region);
    if (!reg) throw new Error('国家/地区不存在');
  }
  const label =
    fields.label !== undefined ? String(fields.label || '').trim().slice(0, 80) : cur.label;
  const server = fields.server !== undefined ? assertServer(fields.server) : cur.server;
  const username =
    fields.username !== undefined
      ? String(fields.username || '').trim() || null
      : cur.username;
  const password =
    fields.password !== undefined
      ? fields.password != null && String(fields.password) !== ''
        ? String(fields.password)
        : null
      : cur.password;
  db.prepare(
    `UPDATE proxy_profiles SET region=?, label=?, server=?, username=?, password=?, updated_at=? WHERE id=?`
  ).run(region, label, server, username, password, now(), id);
  return getProxyProfile(id);
}

export function deleteProxyProfile(id) {
  const cur = getProxyProfile(id);
  if (!cur) throw new Error('代理不存在');
  db.prepare('UPDATE accounts SET proxy_profile_id = NULL WHERE proxy_profile_id = ?').run(id);
  db.prepare('DELETE FROM proxy_profiles WHERE id = ?').run(id);
  return { ok: true };
}
