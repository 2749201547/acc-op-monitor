import { v4 as uuid } from 'uuid';
import db from '../db.js';
import {
  syncAccountMessages,
  sendReply,
  isNoiseConversation,
} from '../browser/messages.js';
import { getAccount, updateAccount, listAccounts } from './accounts.js';
import { getContext } from '../browser/manager.js';
import { cacheAvatar } from '../browser/avatars.js';

function now() {
  return new Date().toISOString();
}

const NAV_NAMES = [
  'TikTok',
  '推荐',
  '主页',
  '探索',
  '关注',
  '朋友',
  '直播',
  '消息',
  'For You',
  'Following',
  'Friends',
  'LIVE',
  'Home',
  'Explore',
  'Profile',
  'Messages',
  '忘记密码?',
  '忘记密码',
  '隐私政策',
  'Messenger',
  'Facebook',
  'Meta',
  'Notifications',
  'Notification',
  '通知',
];

function purgeNoiseConversations(accountId) {
  const rows = db
    .prepare(
      accountId
        ? `SELECT c.id, c.peer_id, c.peer_nickname, c.peer_username, c.last_message, a.platform
           FROM conversations c JOIN accounts a ON a.id = c.account_id WHERE c.account_id = ?`
        : `SELECT c.id, c.peer_id, c.peer_nickname, c.peer_username, c.last_message, a.platform
           FROM conversations c JOIN accounts a ON a.id = c.account_id`
    )
    .all(...(accountId ? [accountId] : []));

  const delMsg = db.prepare('DELETE FROM messages WHERE conversation_id = ?');
  const delConv = db.prepare('DELETE FROM conversations WHERE id = ?');
  for (const row of rows) {
    const noise =
      isNoiseConversation(
        {
          peerId: row.peer_id,
          peerNickname: row.peer_nickname,
          peerUsername: row.peer_username,
          lastMessage: row.last_message,
        },
        row.platform
      ) ||
      String(row.peer_id || '').startsWith('dom_') ||
      NAV_NAMES.some(
        (n) =>
          n.toLowerCase() === String(row.peer_nickname || '').toLowerCase() ||
          n.toLowerCase() === String(row.peer_username || '').toLowerCase()
      );
    if (noise) {
      delMsg.run(row.id);
      delConv.run(row.id);
    }
  }
}

export function listConversations(accountId) {
  let sql = `
    SELECT c.id, c.account_id as accountId, c.peer_id as peerId,
           c.peer_username as peerUsername, c.peer_nickname as peerNickname,
           c.peer_avatar as peerAvatar, c.last_message as lastMessage,
           c.last_message_at as lastMessageAt, c.unread, c.updated_at as updatedAt,
           a.label as accountLabel, a.username as accountUsername,
           a.display_name as accountDisplayName
    FROM conversations c
    JOIN accounts a ON a.id = c.account_id
  `;
  const params = [];
  if (accountId) {
    sql += ' WHERE c.account_id = ?';
    params.push(accountId);
  }
  sql += ' ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC';
  return db.prepare(sql).all(...params);
}

export function listMessages(conversationId) {
  return db
    .prepare(
      `SELECT id, conversation_id as conversationId, account_id as accountId,
              peer_id as peerId, direction, content, message_type as messageType,
              sent_at as sentAt, created_at as createdAt
       FROM messages WHERE conversation_id = ?
       ORDER BY COALESCE(sent_at, created_at) ASC`
    )
    .all(conversationId);
}

function upsertConversation(accountId, c) {
  const existing = db
    .prepare('SELECT id FROM conversations WHERE account_id = ? AND peer_id = ?')
    .get(accountId, c.peerId);
  const id = existing?.id || uuid();
  const t = now();
  const lastAt = c.lastMessageAt || null;
  db.prepare(
    `INSERT INTO conversations
      (id, account_id, peer_id, peer_username, peer_nickname, peer_avatar,
       last_message, last_message_at, unread, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, peer_id) DO UPDATE SET
       peer_username=excluded.peer_username,
       peer_nickname=excluded.peer_nickname,
       peer_avatar=CASE
         WHEN excluded.peer_avatar IS NOT NULL AND excluded.peer_avatar != '' THEN excluded.peer_avatar
         ELSE conversations.peer_avatar
       END,
       last_message=CASE
         WHEN excluded.last_message IS NOT NULL AND excluded.last_message != '' THEN excluded.last_message
         ELSE conversations.last_message
       END,
       last_message_at=COALESCE(excluded.last_message_at, conversations.last_message_at),
       unread=excluded.unread,
       updated_at=COALESCE(excluded.last_message_at, conversations.updated_at, excluded.updated_at)`
  ).run(
    id,
    accountId,
    c.peerId,
    c.peerUsername,
    c.peerNickname,
    c.peerAvatar,
    c.lastMessage || '',
    lastAt,
    c.unread || 0,
    lastAt || t
  );
  return id;
}

function upsertMessage(accountId, conversationId, m) {
  const t = now();
  db.prepare(
    `INSERT INTO messages
      (id, conversation_id, account_id, peer_id, direction, content, message_type, sent_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, id) DO NOTHING`
  ).run(
    m.id,
    conversationId,
    accountId,
    m.peerId,
    m.direction || 'in',
    m.content,
    m.messageType || 'text',
    m.sentAt || t,
    t
  );
}

function previewMessageId(accountId, peerId) {
  return `preview_${accountId}_${peerId}`;
}

/** 会话列表 snippet 占位：稳定 id，避免每次同步因 lastMessageAt 微变而重复插入 */
function upsertPreviewMessage(accountId, conversationId, peerId, lastMessage, lastMessageAt) {
  const hasReal = db
    .prepare(
      `SELECT 1 FROM messages
       WHERE conversation_id = ? AND id NOT LIKE 'preview_%' LIMIT 1`
    )
    .get(conversationId);
  if (hasReal) {
    db.prepare(
      `DELETE FROM messages WHERE conversation_id = ? AND id LIKE 'preview_%'`
    ).run(conversationId);
    return;
  }

  let content = String(lastMessage || '');
  let direction = 'in';
  if (/^you:\s*/i.test(content)) {
    direction = 'out';
    content = content.replace(/^you:\s*/i, '');
  }

  const t = now();
  const id = previewMessageId(accountId, peerId);
  const sentAt = lastMessageAt || null;
  db.prepare(
    `INSERT INTO messages
      (id, conversation_id, account_id, peer_id, direction, content, message_type, sent_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'text', ?, ?)
     ON CONFLICT(account_id, id) DO UPDATE SET
       content=excluded.content,
       direction=excluded.direction,
       sent_at=COALESCE(excluded.sent_at, messages.sent_at)`
  ).run(id, conversationId, accountId, peerId, direction, content.slice(0, 2000), sentAt || t, t);
}

/** 清理历史重复 preview（旧逻辑把时间戳写进 id，每次同步会多一条） */
export function dedupePreviewMessages(accountId) {
  const rows = db
    .prepare(
      accountId
        ? `SELECT id, conversation_id, account_id, sent_at, created_at
           FROM messages WHERE account_id = ? AND id LIKE 'preview_%'`
        : `SELECT id, conversation_id, account_id, sent_at, created_at
           FROM messages WHERE id LIKE 'preview_%'`
    )
    .all(...(accountId ? [accountId] : []));

  const byConv = new Map();
  for (const r of rows) {
    const list = byConv.get(r.conversation_id) || [];
    list.push(r);
    byConv.set(r.conversation_id, list);
  }

  const del = db.prepare('DELETE FROM messages WHERE account_id = ? AND id = ?');
  const rename = db.prepare(
    `UPDATE messages SET id = ? WHERE account_id = ? AND id = ?`
  );
  let removed = 0;

  for (const [, list] of byConv) {
    list.sort((a, b) =>
      String(b.sent_at || b.created_at).localeCompare(String(a.sent_at || a.created_at))
    );
    const keep = list[0];
    for (const extra of list.slice(1)) {
      del.run(extra.account_id, extra.id);
      removed++;
    }
    // 归一成稳定 id，后续同步可覆盖更新
    const peerId = db
      .prepare('SELECT peer_id FROM conversations WHERE id = ?')
      .get(keep.conversation_id)?.peer_id;
    if (peerId) {
      const stable = previewMessageId(keep.account_id, peerId);
      if (keep.id !== stable) {
        del.run(keep.account_id, stable); // 若已存在稳定 id 则先删，再改名
        try {
          rename.run(stable, keep.account_id, keep.id);
        } catch {
          /* unique race: keep as-is */
        }
      }
    }

    // 规范化 Facebook 列表里的 "You: …" 出站 snippet
    const row = db
      .prepare(
        `SELECT id, content FROM messages
         WHERE conversation_id = ? AND id LIKE 'preview_%' LIMIT 1`
      )
      .get(keep.conversation_id);
    if (row && /^you:\s*/i.test(row.content || '')) {
      db.prepare(
        `UPDATE messages SET content = ?, direction = 'out' WHERE id = ? AND account_id = ?`
      ).run(String(row.content).replace(/^you:\s*/i, ''), row.id, keep.account_id);
    }
  }
  return removed;
}

export async function syncOne(accountId, opts = {}) {
  const account = getAccount(accountId);
  if (!account) throw new Error('账号不存在');
  if (account.status !== 'active') {
    return { ok: false, reason: 'account_not_active' };
  }

  const result = await syncAccountMessages(accountId, {
    windowBounds: opts.windowBounds || null,
  });
  if (!result.ok) return result;

  // 清掉误抓的导航项（TikTok / 推荐 / 主页 …）
  purgeNoiseConversations(accountId);

  let username = result.profile?.username || account.username;
  const isBadAccountName = (name) => {
    const t = String(name || '')
      .trim()
      .toLowerCase()
      .replace(/^[,.\s]+/, '');
    if (!t) return true;
    if (/\b(account|profile|menu|settings)\b/i.test(t) && /your|,/.test(t)) return true;
    return (
      /^(notifications?|忘记密码\??|messenger|facebook|meta|find friends|controls and settings|,?\s*your profile|your profile|my profile|account|账号|账户)$/i.test(
        t
      ) || /your profile|controls and settings/i.test(t)
    );
  };
  const isWeakAccountName = (name) =>
    isBadAccountName(name) || /^\d{5,}$/.test(String(name || '').trim());
  // 优先用本次同步读到的名字；噪声名必须覆盖；纯数字 id 不要覆盖已有真人名
  let displayName = result.profile?.displayName;
  if (isWeakAccountName(displayName)) {
    displayName = isWeakAccountName(account.displayName)
      ? username || account.label
      : account.displayName;
  }
  let avatarUrl = result.profile?.avatarUrl || account.avatarUrl;
  if (avatarUrl && !String(avatarUrl).startsWith('/media/')) {
    try {
      const ctx = await getContext(accountId, { headless: true });
      avatarUrl = await cacheAvatar(ctx, avatarUrl, `account_${accountId}`);
    } catch {
      /* keep remote */
    }
  }
  if (username || displayName || avatarUrl) {
    updateAccount(accountId, { username, displayName, avatarUrl });
  }

  const convMap = new Map();
  for (const c of result.conversations) {
    if (isNoiseConversation(c, account.platform)) continue;
    const cid = upsertConversation(accountId, c);
    convMap.set(c.peerId, cid);

    // 仅在尚无真实消息时，用会话列表 snippet 占位（稳定 id，不随时间戳膨胀）
    if (c.lastMessage) {
      upsertPreviewMessage(accountId, cid, c.peerId, c.lastMessage, c.lastMessageAt);
    }
  }

  dedupePreviewMessages(accountId);

  for (const m of result.messages) {
    let cid = convMap.get(m.peerId);
    if (!cid) {
      cid = upsertConversation(accountId, {
        peerId: m.peerId,
        peerUsername: m.peerId,
        peerNickname: m.peerId,
        peerAvatar: null,
        lastMessage: m.content,
        lastMessageAt: m.sentAt,
        unread: 0,
      });
      convMap.set(m.peerId, cid);
    }
    upsertMessage(accountId, cid, m);
  }

  updateAccount(accountId, { lastSyncAt: now() });
  return {
    ok: true,
    reason: result.reason,
    conversations: result.conversations.length,
    messages: result.messages.length,
  };
}

export async function syncAll(opts = {}) {
  const accounts = listAccounts().filter((a) => a.status === 'active');
  const results = [];
  const windowBounds = opts.windowBounds || null;
  for (const a of accounts) {
    try {
      results.push({
        accountId: a.id,
        ...(await syncOne(a.id, { windowBounds })),
      });
    } catch (e) {
      results.push({ accountId: a.id, ok: false, reason: e.message });
    }
  }
  return results;
}

export async function reply(conversationId, text, opts = {}) {
  const conv = db
    .prepare(
      `SELECT id, account_id as accountId, peer_id as peerId,
              peer_username as peerUsername, peer_nickname as peerNickname
       FROM conversations WHERE id = ?`
    )
    .get(conversationId);
  if (!conv) throw new Error('会话不存在');

  const account = getAccount(conv.accountId);
  const peerId = String(conv.peerId || '');
  // Facebook：优先真实 thread id；TikTok / DOM 兜底：用昵称匹配列表项
  const target =
    account?.platform === 'facebook' && peerId && !peerId.startsWith('dom_')
      ? peerId
      : conv.peerNickname || conv.peerUsername || peerId;
  const result = await sendReply(conv.accountId, target, text, {
    windowBounds: opts.windowBounds || null,
  });
  if (!result.ok) return result;

  const msgId = `local_${uuid()}`;
  const t = now();
  upsertMessage(conv.accountId, conv.id, {
    id: msgId,
    peerId: conv.peerId,
    direction: 'out',
    content: text,
    sentAt: t,
  });
  db.prepare(
    `UPDATE conversations SET last_message=?, last_message_at=?, updated_at=? WHERE id=?`
  ).run(text, t, t, conv.id);

  return { ok: true, messageId: msgId };
}
