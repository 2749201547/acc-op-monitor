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
];

function purgeNoiseConversations(accountId) {
  const rows = db
    .prepare(
      accountId
        ? 'SELECT id, peer_nickname, peer_username, last_message FROM conversations WHERE account_id = ?'
        : 'SELECT id, peer_nickname, peer_username, last_message FROM conversations'
    )
    .all(...(accountId ? [accountId] : []));

  const delMsg = db.prepare('DELETE FROM messages WHERE conversation_id = ?');
  const delConv = db.prepare('DELETE FROM conversations WHERE id = ?');
  for (const row of rows) {
    if (
      isNoiseConversation({
        peerNickname: row.peer_nickname,
        peerUsername: row.peer_username,
        lastMessage: row.last_message,
      }) ||
      NAV_NAMES.some(
        (n) =>
          n.toLowerCase() === String(row.peer_nickname || '').toLowerCase() ||
          n.toLowerCase() === String(row.peer_username || '').toLowerCase()
      )
    ) {
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
  sql += ' ORDER BY c.updated_at DESC';
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
  db.prepare(
    `INSERT INTO conversations
      (id, account_id, peer_id, peer_username, peer_nickname, peer_avatar,
       last_message, last_message_at, unread, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, peer_id) DO UPDATE SET
       peer_username=excluded.peer_username,
       peer_nickname=excluded.peer_nickname,
       peer_avatar=COALESCE(excluded.peer_avatar, conversations.peer_avatar),
       last_message=excluded.last_message,
       last_message_at=excluded.last_message_at,
       unread=excluded.unread,
       updated_at=excluded.updated_at`
  ).run(
    id,
    accountId,
    c.peerId,
    c.peerUsername,
    c.peerNickname,
    c.peerAvatar,
    c.lastMessage || '',
    c.lastMessageAt || t,
    c.unread || 0,
    c.lastMessageAt || t
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

export async function syncOne(accountId) {
  const account = getAccount(accountId);
  if (!account) throw new Error('账号不存在');
  if (account.status !== 'active') {
    return { ok: false, reason: 'account_not_active' };
  }

  const result = await syncAccountMessages(accountId);
  if (!result.ok) return result;

  // 清掉误抓的导航项（TikTok / 推荐 / 主页 …）
  purgeNoiseConversations(accountId);

  let username = result.profile?.username || account.username;
  let displayName = result.profile?.displayName || account.displayName;
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
    if (isNoiseConversation(c)) continue;
    const cid = upsertConversation(accountId, c);
    convMap.set(c.peerId, cid);

    // Ensure at least a placeholder message for inbox preview
    if (c.lastMessage) {
      upsertMessage(accountId, cid, {
        id: `preview_${c.peerId}_${c.lastMessageAt || ''}`,
        peerId: c.peerId,
        direction: 'in',
        content: c.lastMessage,
        sentAt: c.lastMessageAt,
      });
    }
  }

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

export async function syncAll() {
  const accounts = listAccounts().filter((a) => a.status === 'active');
  const results = [];
  for (const a of accounts) {
    try {
      results.push({ accountId: a.id, ...(await syncOne(a.id)) });
    } catch (e) {
      results.push({ accountId: a.id, ok: false, reason: e.message });
    }
  }
  return results;
}

export async function reply(conversationId, text) {
  const conv = db
    .prepare(
      `SELECT id, account_id as accountId, peer_id as peerId,
              peer_username as peerUsername, peer_nickname as peerNickname
       FROM conversations WHERE id = ?`
    )
    .get(conversationId);
  if (!conv) throw new Error('会话不存在');

  const target = conv.peerNickname || conv.peerUsername || conv.peerId;
  const result = await sendReply(conv.accountId, target, text);
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
