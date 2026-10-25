import { getContext, isLoggedIn } from './manager.js';
import { cacheAvatar, cacheAvatarFromLocator, extractAvatarUrl } from './avatars.js';

/**
 * Sync inbox from TikTok web messages page.
 * TikTok DOM changes often — this extracts what it can and returns structured data.
 */
export async function syncAccountMessages(accountId) {
  const context = await getContext(accountId, { headless: true });
  if (!(await isLoggedIn(context))) {
    return {
      ok: false,
      reason: 'not_logged_in',
      conversations: [],
      messages: [],
      profile: null,
    };
  }

  const page = context.pages()[0] || (await context.newPage());

  // Listen before navigation so we catch inbox APIs
  const captured = [];
  const onResponse = async (res) => {
    try {
      const url = res.url();
      if (!/im\/|message|inbox|chat|conversation|user\/detail|api\/user/i.test(url)) {
        return;
      }
      if (!res.ok()) return;
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json') && !ct.includes('javascript')) return;
      const json = await res.json().catch(() => null);
      if (json) captured.push({ url, json });
    } catch {
      /* ignore */
    }
  };
  page.on('response', onResponse);

  // 只打开一次消息页，等列表出现就抓，避免二次 reload 浪费时间
  const alreadyOnMessages = page.url().includes('/messages');
  if (!alreadyOnMessages) {
    await page.goto('https://www.tiktok.com/messages', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
  } else {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  }

  await Promise.race([
    page.waitForSelector('img[src*="tiktokcdn"], img[src*="bytedance"], [class*="ChatList"] img', {
      timeout: 8000,
    }),
    page.waitForTimeout(2500),
  ]).catch(() => {});
  await page.waitForTimeout(800);
  page.off('response', onResponse);

  // 同步时用轻量读资料（不额外跳转主页/个人页）
  let profile = null;
  try {
    profile = await readProfileLight(page);
  } catch {
    profile = null;
  }

  // 账号头像：优先截取页面上的头像节点，避免 CDN 防盗链导致左侧不显示
  try {
    const shot = await cacheAvatarFromLocator(
      page,
      page.locator(
        '[data-e2e="profile-icon"] img, [class*="Avatar"] img, a[href^="/@"] img'
      ),
      `account_${accountId}`
    );
    if (shot) {
      profile = profile || { username: null, displayName: null, avatarUrl: null };
      profile.avatarUrl = shot;
    }
  } catch {
    /* ignore */
  }

  const fromNetwork = parseNetworkPayloads(captured);
  const fromDom = await scrapeDomConversations(page);

  // Prefer network when available; merge avatars from DOM by nickname
  const merged = mergeConversations(fromNetwork.conversations, fromDom.conversations);
  const messages = fromNetwork.messages;

  // 头像并行缓存（最多 6 路），比一个个下快很多
  await cacheAvatarsParallel(context, accountId, merged, profile);

  return {
    ok: true,
    reason: fromNetwork.conversations.length ? 'network+dom' : 'dom',
    conversations: merged,
    messages,
    profile,
  };
}

async function cacheAvatarsParallel(context, accountId, merged, profile) {
  const tasks = [];
  for (const c of merged) {
    if (c.peerAvatar && !c.peerAvatar.startsWith('/media/')) {
      tasks.push(async () => {
        c.peerAvatar = await cacheAvatar(
          context,
          c.peerAvatar,
          `${accountId}_${c.peerId}`
        );
      });
    }
  }
  if (profile?.avatarUrl && !profile.avatarUrl.startsWith('/media/')) {
    tasks.push(async () => {
      profile.avatarUrl = await cacheAvatar(
        context,
        profile.avatarUrl,
        `account_${accountId}`
      );
    });
  }

  const concurrency = 6;
  for (let i = 0; i < tasks.length; i += concurrency) {
    await Promise.all(tasks.slice(i, i + concurrency).map((fn) => fn()));
  }
}

async function readProfileLight(page) {
  return page.evaluate(() => {
    const pick = (user) => {
      if (!user) return null;
      const fields = [
        user.avatarThumb,
        user.avatarMedium,
        user.avatarLarger,
        user.avatar_thumb,
        user.avatar_url,
        user.avatarUrl,
        user.avatar,
      ];
      for (const f of fields) {
        if (!f) continue;
        if (typeof f === 'string' && f.startsWith('http')) return f;
        if (f.url_list?.[0]) return f.url_list[0];
      }
      return null;
    };

    const next = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (next?.textContent) {
      try {
        const data = JSON.parse(next.textContent);
        const user = data?.__DEFAULT_SCOPE__?.['webapp.app-context']?.user;
        if (user) {
          return {
            username: user.uniqueId || user.unique_id || null,
            displayName: user.nickname || null,
            avatarUrl: pick(user),
          };
        }
      } catch {
        /* ignore */
      }
    }

    const img =
      document.querySelector('[data-e2e="profile-icon"] img') ||
      document.querySelector('img[class*="Avatar"]');
    const link = document.querySelector('a[href^="/@"]');
    const m = link?.getAttribute('href')?.match(/\/@([\w.-]+)/);
    return {
      username: m?.[1] || null,
      displayName: m?.[1] || null,
      avatarUrl: img?.currentSrc || img?.src || null,
    };
  });
}

async function scrapeDomConversations(page) {
  const conversations = await page.evaluate(() => {
    const results = [];
    const seen = new Set();
    const blocked = new Set([
      'tiktok',
      '推荐',
      '主页',
      '探索',
      '关注',
      '朋友',
      '直播',
      '消息',
      '私信',
      '搜索',
      '更多',
      '设置',
      '上传',
      '创作',
      '通知',
      'for you',
      'following',
      'friends',
      'live',
      'home',
      'explore',
      'profile',
      'search',
      'messages',
      'inbox',
      'upload',
      'notifications',
      'settings',
      '全部',
      '未读',
    ]);
    const isNav = (text) => blocked.has(String(text || '').trim().toLowerCase());

    const pickImg = (root) => {
      const imgs = [...root.querySelectorAll('img')];
      for (const img of imgs) {
        const src = img.currentSrc || img.src || img.getAttribute('src') || '';
        if (!src || src.startsWith('data:')) continue;
        if (/emoji|icon|svg|flag/i.test(src)) continue;
        if (
          /tiktokcdn|bytedance|avatar|jpeg|jpg|png|webp|image/i.test(src) ||
          src.startsWith('http')
        ) {
          return src;
        }
      }
      return null;
    };

    const candidates = [
      ...document.querySelectorAll('[data-e2e*="chat"]'),
      ...document.querySelectorAll('[class*="ConversationList"] [class*="Item"]'),
      ...document.querySelectorAll('[class*="DivChatList"] > div'),
      ...document.querySelectorAll('[class*="chat-list"] > div'),
      ...document.querySelectorAll('[class*="conversation"]'),
    ];

    // Fallback: any block that looks like "avatar + name"
    if (candidates.length < 3) {
      for (const el of document.querySelectorAll('div, li, a')) {
        const img = el.querySelector('img');
        const text = (el.innerText || '').trim();
        if (!img || !text || text.length < 2 || text.length > 300) continue;
        if ((el.querySelectorAll('img') || []).length > 3) continue;
        candidates.push(el);
      }
    }

    for (const el of candidates) {
      const text = (el.innerText || '').trim();
      if (!text || text.length < 2 || text.length > 400) continue;
      const lines = text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!lines.length) continue;

      const peer = lines[0];
      if (isNav(peer)) continue;
      if (seen.has(peer)) continue;

      const avatar = pickImg(el);
      if (!avatar && peer.length < 2) continue;
      if (lines[1] && isNav(lines[1])) continue;

      seen.add(peer);
      results.push({
        peerId: `dom_${peer}`,
        peerUsername: peer,
        peerNickname: peer,
        peerAvatar: avatar,
        lastMessage: lines[1] || '',
        lastMessageAt: new Date().toISOString(),
        unread: 0,
      });
    }

    return results.filter((c) => !isNav(c.peerNickname)).slice(0, 80);
  });

  return { conversations, messages: [] };
}

/** TikTok 左侧导航文案，容易被 DOM 误当成会话 */
function isNavLabel(text) {
  const t = String(text || '')
    .trim()
    .toLowerCase();
  if (!t) return true;
  const blocked = new Set([
    'tiktok',
    '推荐',
    '主页',
    '探索',
    '关注',
    '朋友',
    '直播',
    '消息',
    '私信',
    '搜索',
    '更多',
    '设置',
    '上传',
    '创作',
    '通知',
    'for you',
    'following',
    'friends',
    'live',
    'home',
    'explore',
    'profile',
    'search',
    'messages',
    'inbox',
    'upload',
    'notifications',
    'settings',
    '全部',
    '未读',
  ]);
  return blocked.has(t);
}

function mergeConversations(networkList, domList) {
  const byNick = new Map();
  for (const c of domList) {
    if (isNoiseConversation(c)) continue;
    byNick.set(norm(c.peerNickname || c.peerUsername), c);
  }

  const out = [];
  const used = new Set();

  for (const n of networkList) {
    if (isNoiseConversation(n)) continue;
    const key = norm(n.peerNickname || n.peerUsername);
    const d = byNick.get(key);
    if (d?.peerAvatar && !n.peerAvatar) n.peerAvatar = d.peerAvatar;
    out.push(n);
    used.add(key);
  }

  for (const d of domList) {
    if (isNoiseConversation(d)) continue;
    const key = norm(d.peerNickname || d.peerUsername);
    if (used.has(key)) continue;
    out.push(d);
  }
  return out;
}

export function isNoiseConversation(c) {
  const name = c?.peerNickname || c?.peerUsername || '';
  if (isNavLabel(name)) return true;
  if (isNavLabel(c?.lastMessage)) return true;
  return false;
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function parseNetworkPayloads(captured) {
  const conversations = [];
  const messages = [];

  for (const { json } of captured) {
    walk(json, (obj) => {
      if (!obj || typeof obj !== 'object') return;

      const peerId =
        obj.conversation_id ||
        obj.conversationId ||
        obj.talk_id ||
        obj.user_id ||
        obj.userId ||
        obj.to_user_id ||
        obj.from_user_id;
      const nick =
        obj.nickname ||
        obj.nick_name ||
        obj.unique_id ||
        obj.uniqueId ||
        obj.username ||
        obj.name;
      const last =
        obj.last_msg_content ||
        obj.lastMessage ||
        obj.content ||
        obj.text ||
        obj.body;

      const avatar = extractAvatarUrl(obj);

      if (peerId && nick && typeof nick === 'string' && nick.length < 80) {
        conversations.push({
          peerId: String(peerId),
          peerUsername: String(nick),
          peerNickname: String(nick),
          peerAvatar: avatar,
          lastMessage: last ? String(last).slice(0, 500) : '',
          lastMessageAt: toIso(obj.create_time || obj.createTime || obj.timestamp),
          unread: Number(obj.unread || obj.badge || 0) || 0,
        });
      }

      if (
        (obj.content || obj.text || obj.body) &&
        (obj.msg_id || obj.message_id || obj.client_message_id || obj.id) &&
        (obj.create_time || obj.createTime || obj.timestamp)
      ) {
        const mid = String(
          obj.msg_id || obj.message_id || obj.client_message_id || obj.id
        );
        messages.push({
          id: mid,
          peerId: String(peerId || obj.from_user_id || obj.to_user_id || 'unknown'),
          direction: guessDirection(obj),
          content: String(obj.content || obj.text || obj.body).slice(0, 2000),
          messageType: obj.msg_type || obj.type || 'text',
          sentAt: toIso(obj.create_time || obj.createTime || obj.timestamp),
        });
      }
    });
  }

  const cmap = new Map();
  for (const c of conversations) {
    const prev = cmap.get(c.peerId);
    if (!prev || (!prev.peerAvatar && c.peerAvatar)) cmap.set(c.peerId, c);
  }
  const mmap = new Map();
  for (const m of messages) {
    if (!mmap.has(m.id)) mmap.set(m.id, m);
  }

  return {
    conversations: [...cmap.values()],
    messages: [...mmap.values()],
  };
}

function walk(node, visit, depth = 0) {
  if (depth > 14 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    visit(node);
    for (const v of Object.values(node)) walk(v, visit, depth + 1);
  }
}

function toIso(t) {
  if (!t) return new Date().toISOString();
  const n = Number(t);
  if (!Number.isNaN(n)) {
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function guessDirection(obj) {
  if (obj.is_self === true || obj.isSelf === true || obj.direction === 'out') return 'out';
  if (obj.is_self === false || obj.direction === 'in') return 'in';
  return 'in';
}

export async function sendReply(accountId, peerUsernameOrId, text) {
  const context = await getContext(accountId, { headless: true });
  if (!(await isLoggedIn(context))) {
    return { ok: false, reason: 'not_logged_in' };
  }

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://www.tiktok.com/messages', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(3000);

  const target = String(peerUsernameOrId);
  const clicked = await page.evaluate((name) => {
    const nodes = [...document.querySelectorAll('a, div, li, span')];
    for (const el of nodes) {
      const t = (el.textContent || '').trim();
      if (t === name || t.startsWith(name + '\n') || t.includes(name)) {
        const clickable =
          el.closest('a, li, div[role="button"], div[class*="conversation"]') || el;
        clickable.click();
        return true;
      }
    }
    return false;
  }, target);

  if (!clicked) {
    return { ok: false, reason: 'conversation_not_found' };
  }

  await page.waitForTimeout(1500);

  const input = page
    .locator(
      'div[contenteditable="true"], textarea, [data-e2e*="message-input"], [class*="DraftEditor"]'
    )
    .first();

  if (!(await input.isVisible().catch(() => false))) {
    return { ok: false, reason: 'input_not_found' };
  }

  await input.click();
  await input.fill(text).catch(async () => {
    await page.keyboard.type(text, { delay: 20 });
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);

  return { ok: true };
}
