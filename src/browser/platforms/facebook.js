import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { cacheAvatar, cacheAvatarFromLocator, avatarsDir } from '../avatars.js';

export const PLATFORM = 'facebook';

export const loginHints = {
  dialogTitle: 'Facebook 登录',
  waitingMessage: '请在弹出的浏览器窗口中完成 Facebook 登录（账密 / 二次验证）',
  placeholder: '浏览器启动后请在弹出窗口完成登录',
};

const MESSENGER_LOGIN = 'https://www.messenger.com/login';
const FACEBOOK_LOGIN = 'https://www.facebook.com/login';
const FB_MESSAGES = 'https://www.facebook.com/messages/';

const NOISE_NAMES = new Set([
  'chats',
  'chat',
  'marketplace',
  'message requests',
  '消息请求',
  '聊天',
  '搜索',
  'search',
  'settings',
  '设置',
  'archived',
  '已归档',
  'messenger',
  'facebook',
  'meta',
  'home',
  '主页',
  'people',
  'contacts',
  '联系人',
  '忘记密码?',
  '忘记密码',
  'forgot password?',
  'forgot password',
  '隐私政策',
  'privacy policy',
  '隐私和安全',
  '服务条款',
  'terms',
  'cookie',
  'cookies',
  '创建账户',
  'create new account',
  'log in',
  'login',
  '登录',
  '继续',
  'continue',
  '全部',
  '未读',
  'inbox',
  'community chats',
  'communities',
  'groups',
  '功能',
  '你的账号',
  '切换账户',
  'features',
  'your account',
  'switch accounts',
  'notifications',
  'notification',
  '通知',
  'friends',
  'friend requests',
  'find friends',
  'watch',
  'gaming',
  'more',
  'all',
  'unread',
  'skip to main content',
  'skip to messages',
  'skip to compose',
  'new message',
  'reply?',
  'follow up?',
  'controls and settings',
  'message request',
  'message requests',
  'no chats selected',
]);

function isNoiseName(text) {
  const t = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!t) return true;
  if (NOISE_NAMES.has(t)) return true;
  if (/^meta\b/i.test(t)) return true;
  if (/忘记密码|forgot\s*password|隐私政策|privacy\s*policy|隐私和安全/i.test(t)) return true;
  if (/以\s*.+\s*的身份继续|continue as /i.test(t)) return true;
  if (/notification|find friends|skip to |controls and settings/i.test(t)) return true;
  if (/enter your pin|restore your chats|one-time code|message request/i.test(t)) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^dom_/i.test(t)) return true;
  // 账号按钮 aria-label 噪声：Account, your profile → ", your profile"
  if (/your profile|my profile|account menu|账号菜单|个人主页|你的主页/i.test(t)) return true;
  if (/^[,.\-\s]*$/.test(t)) return true;
  return false;
}

/** 自己的显示名：额外拒绝纯 UI 文案 */
function isBadSelfName(text) {
  if (isNoiseName(text)) return true;
  const t = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/^[,.\s]+/, '');
  if (!t || t.length < 2) return true;
  if (/^(your profile|my profile|profile|account|账号|账户|你的账号)$/i.test(t)) return true;
  // "Account, your" / "Account, your profile" 等按钮文案碎片
  if (/\b(account|profile|menu|settings|options)\b/i.test(t)) return true;
  if (/\byour\b/i.test(t)) return true;
  if (/^\d{5,}$/.test(t)) return true; // 纯数字 id 不算好名字，但可作 fallback
  return false;
}

function cleanSelfName(text) {
  let t = String(text || '')
    .trim()
    .replace(/\s+/g, ' ');
  t = t.replace(/^[,.\s]+/, '').replace(/[,.\s]+$/, '');
  t = t.replace(/\s*[|·•].*$/, ''); // "Name | Facebook"
  t = t.replace(/\s+on Facebook$/i, '');
  t = t.replace(/'s profile$/i, '').replace(/的主页$/i, '');
  return t.trim();
}

function isUsableAvatarUrl(src) {
  if (!src || typeof src !== 'string') return false;
  if (src.startsWith('/media/')) return true;
  if (src.startsWith('data:') || src.startsWith('blob:')) return false;
  if (!/^https?:\/\//i.test(src)) return false;
  if (/rsrc\.php|static\.xx\.fbcdn|static\.facebook|messenger_icon|ic_messenger|\blogo\b/i.test(src)) {
    return false;
  }
  if (/emoji|sticker|icon|svg/i.test(src)) return false;
  return /scontent|fbcdn\.net|fbsbx\.com|graph\.facebook\.com/i.test(src);
}

function looksLikeIconBuffer(buf) {
  if (!buf || buf.length < 80) return true;
  return buf.length < 2500;
}

export async function isLoggedIn(context) {
  const domains = ['https://www.facebook.com', 'https://www.messenger.com'];
  for (const d of domains) {
    const cookies = await context.cookies(d).catch(() => []);
    const hasUser = cookies.some((c) => c.name === 'c_user' && c.value);
    const hasXs = cookies.some((c) => c.name === 'xs' && c.value);
    if (hasUser && hasXs) return true;
  }
  return false;
}

async function getCUserId(context) {
  for (const d of ['https://www.facebook.com', 'https://www.messenger.com']) {
    const cookies = await context.cookies(d).catch(() => []);
    const c = cookies.find((x) => x.name === 'c_user' && x.value);
    if (c) return c.value;
  }
  return null;
}

async function dismissInterstitials(page) {
  const candidates = [
    page.getByRole('button', { name: /继续|Continue|Allow|允许|Not now|以后再说|接受|Accept/i }),
    page.getByText(/^继续$/, { exact: true }),
    page.getByText(/^Continue$/, { exact: true }),
    page.getByText(/以 .+ 的身份继续|Continue as /i),
  ];
  for (const loc of candidates) {
    try {
      const el = loc.first();
      if (await el.isVisible({ timeout: 500 })) {
        await el.click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(600);
      }
    } catch {
      /* next */
    }
  }
}

async function isPinDialogVisible(page) {
  const pinText = page.getByText(/Enter your PIN|输入.*PIN|restore your chats|恢复.*聊天/i).first();
  return pinText.isVisible({ timeout: 800 }).catch(() => false);
}

/**
 * Messenger 端到端加密 PIN：等用户在弹出窗口输入正确 PIN（或关掉弹窗）。
 * 最多等 3 分钟。
 */
async function waitForPinDialog(page) {
  if (!(await isPinDialogVisible(page))) return { waited: false };

  console.log('[facebook] 检测到 PIN 弹窗，等待用户输入…');
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    if (!(await isPinDialogVisible(page))) {
      await page.waitForTimeout(1500);
      return { waited: true, resolved: true };
    }
    await page.waitForTimeout(1500);
  }
  // 超时则尝试关掉弹窗继续抓已有列表
  const closeBtn = page
    .locator('[aria-label="Close"], [aria-label="关闭"], [role="dialog"] [aria-label*="Close"]')
    .first();
  if (await closeBtn.isVisible({ timeout: 800 }).catch(() => false)) {
    await closeBtn.click().catch(() => {});
    await page.waitForTimeout(1000);
  }
  return { waited: true, resolved: false };
}

async function countThreadLinks(page) {
  return page
    .locator('a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"], a[href*="/t/"]')
    .count()
    .catch(() => 0);
}

/** 固定进 facebook.com/messages（实测可用），并处理 PIN */
async function ensureInboxPage(page) {
  await page.goto(FB_MESSAGES, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
  await dismissInterstitials(page);
  await page.waitForTimeout(2000);

  await Promise.race([
    page.waitForSelector('a[href*="/t/"]', { timeout: 15000 }),
    page.waitForTimeout(5000),
  ]).catch(() => {});

  await waitForPinDialog(page);

  let n = await countThreadLinks(page);
  if (n > 1) return true;

  // 偶尔落在营销页，再试一次
  await page.goto(FB_MESSAGES, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
  await dismissInterstitials(page);
  await page.waitForTimeout(2500);
  await waitForPinDialog(page);
  n = await countThreadLinks(page);
  return n > 1;
}

async function saveAvatarBuffer(buf, key, extHint = 'jpg', { allowSmall = false } = {}) {
  // 自己的头像缩略图可能 <2.5KB；会话误截的 logo 仍拦截
  if (!allowSmall && looksLikeIconBuffer(buf)) return null;
  if (!buf || buf.length < 600) return null;
  const hash = crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 20);
  const ext = extHint === 'png' ? 'png' : extHint === 'webp' ? 'webp' : 'jpg';
  const filename = `${hash}.${ext}`;
  const filePath = path.join(avatarsDir, filename);
  fs.writeFileSync(filePath, buf);
  return `/media/avatars/${filename}`;
}

function accountAvatarCachePath(key, ext = 'jpg') {
  const hash = crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 20);
  return path.join(avatarsDir, `${hash}.${ext}`);
}

/** 强制重抓自己的头像时，清掉旧缓存，避免一直返回会话里误截的图 */
function clearAccountAvatarCache(key) {
  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    const p = accountAvatarCachePath(key, ext);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

/**
 * 收件箱右上角常是 ctp=s40x40 缩略图。
 * 只改 ctp（或去掉 ctp），不要动 stp/签名参数，否则 CDN 会 403。
 */
function enlargeFbAvatarUrl(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    if (u.searchParams.has('ctp')) u.searchParams.set('ctp', 's320x320');
    return u.toString();
  } catch {
    return url.replace(/ctp=s\d+x\d+/gi, 'ctp=s320x320');
  }
}

/**
 * 用新开 tab goto CDN 图（实测 page.request / fetch 常 ECONNRESET，goto 可用）
 */
async function cacheAvatarViaPageFetch(page, remoteUrl, key) {
  if (!page || !isUsableAvatarUrl(remoteUrl)) return null;
  const ctx = page.context();
  const urls = [...new Set([enlargeFbAvatarUrl(remoteUrl), remoteUrl].filter(Boolean))];

  for (const url of urls) {
    let tab = null;
    try {
      tab = await ctx.newPage();
      const res = await tab.goto(url, { waitUntil: 'load', timeout: 20000 });
      if (!res || !(res.ok() || res.status() === 304)) continue;
      const buf = Buffer.from(await res.body());
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (buf.length < 800) continue;
      const saved = await saveAvatarBuffer(
        buf,
        key,
        ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg',
        { allowSmall: true }
      );
      if (saved) return saved;
    } catch {
      /* try next */
    } finally {
      if (tab) await tab.close().catch(() => {});
    }
  }
  return null;
}

async function fetchGraphAvatar(context, userId, key) {
  if (!userId) return null;
  const urls = [
    `https://graph.facebook.com/${userId}/picture?type=large&redirect=1`,
    `https://graph.facebook.com/${userId}/picture?width=320&height=320&redirect=1`,
  ];
  for (const url of urls) {
    try {
      const res = await context.request.get(url, { maxRedirects: 10, timeout: 10000 });
      if (!res.ok()) continue;
      const buf = Buffer.from(await res.body());
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('image') && buf[0] !== 0xff && buf[0] !== 0x89 && buf[0] !== 0x52) {
        continue;
      }
      const saved = await saveAvatarBuffer(
        buf,
        key,
        ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
      );
      if (saved) return saved;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** 从个人页 og:image / 头像节点取自己的头像（不要用收件箱会话列表图） */
async function fetchViewerAvatar(context, userId, key, page = null) {
  if (!userId) return null;

  // 1) Graph 最稳：按 c_user id 拉自己的头像
  const fromGraph = await fetchGraphAvatar(context, userId, key);
  if (fromGraph) return fromGraph;

  const profileUrls = [
    `https://www.facebook.com/profile.php?id=${encodeURIComponent(userId)}`,
    `https://www.facebook.com/${encodeURIComponent(userId)}`,
    'https://www.facebook.com/me',
  ];

  // 2) HTTP 里的 og:image
  for (const url of profileUrls) {
    try {
      const res = await context.request.get(url, {
        maxRedirects: 5,
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      if (!res.ok()) continue;
      const html = await res.text();
      const m =
        html.match(/property="og:image"\s+content="([^"]+)"/i) ||
        html.match(/content="([^"]+)"\s+property="og:image"/i);
      if (m?.[1] && isUsableAvatarUrl(m[1])) {
        const local = await cacheAvatar(context, m[1], key);
        if (local) return local;
      }
    } catch {
      /* try next */
    }
  }

  // 不再短开个人页截头像（易卡 PIN）；Graph / og:image 失败就交给收件箱「自己的按钮」兜底
  return null;
}

function nameFromHtml(html) {
  if (!html) return null;
  const patterns = [
    /property="og:title"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="og:title"/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /"NAME"\s*:\s*"((?:\\.|[^"\\])*)"/,
    /"name"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"__typename"\s*:\s*"User"/,
    /"displayName"\s*:\s*"((?:\\.|[^"\\])*)"/,
    /<title[^>]*>([^<]+)<\/title>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m?.[1]) continue;
    const raw = m[1]
      .replace(/\\u([\dA-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\"/g, '"');
    const name = cleanSelfName(raw);
    if (name && !isBadSelfName(name) && !/^\d+$/.test(name) && !/^facebook$/i.test(name)) {
      return name;
    }
  }
  return null;
}

/** 用登录态取真实姓名：先 HTTP，再必要时短开个人页 */
async function fetchViewerName(context, userId, page = null) {
  if (!userId) return null;
  const urls = [
    `https://www.facebook.com/profile.php?id=${encodeURIComponent(userId)}`,
    `https://www.facebook.com/${encodeURIComponent(userId)}`,
    'https://www.facebook.com/me',
  ];
  for (const url of urls) {
    try {
      const res = await context.request.get(url, {
        maxRedirects: 5,
        timeout: 10000,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (!res.ok()) continue;
      const name = nameFromHtml(await res.text());
      if (name) return name;
    } catch {
      /* try next */
    }
  }

  // 不再短开个人页：容易卡 PIN / 锁配置目录；名字以 HTTP 解析为准，失败则退回数字 id
  return null;
}

async function scrapeSelfInfoFromPage(page) {
  return page.evaluate((noiseList) => {
    const noise = new Set(noiseList);
    const bad = (t) => {
      const s = String(t || '')
        .trim()
        .toLowerCase()
        .replace(/^[,.\s]+/, '');
      if (!s || s.length > 80 || noise.has(s)) return true;
      if (/find friends|notification|messenger|facebook|your profile|my profile|account menu/i.test(s)) {
        return true;
      }
      if (/^(account|profile|账号|账户)$/i.test(s)) return true;
      return false;
    };

    const candidates = [];
    const push = (t) => {
      const s = String(t || '')
        .trim()
        .replace(/\s+/g, ' ');
      if (!s || bad(s)) return;
      candidates.push(s);
    };

    const selfBtn =
      document.querySelector('[aria-label="Your profile"]') ||
      document.querySelector('[aria-label^="Your profile:"]') ||
      document.querySelector('[aria-label^="Account, your profile"]') ||
      document.querySelector('[aria-label*="你的个人主页"]') ||
      document.querySelector('[aria-label="账号"]') ||
      null;

    let avatarUrl = null;
    if (selfBtn) {
      const img =
        selfBtn.querySelector('image') ||
        selfBtn.querySelector('img') ||
        selfBtn.closest('div')?.querySelector('image, img');
      if (img) {
        avatarUrl =
          img.getAttribute('xlink:href') ||
          img.getAttribute('href') ||
          img.currentSrc ||
          img.src ||
          null;
        if (avatarUrl && /rsrc\.php|static\.xx\.fbcdn/i.test(avatarUrl)) avatarUrl = null;
      }
    }

    for (const el of document.querySelectorAll('[aria-label]')) {
      const label = (el.getAttribute('aria-label') || '').trim();
      if (!label) continue;

      let m = label.match(/^(.+?)'s profile$/i);
      if (m?.[1] && !/^(your|my)$/i.test(m[1].trim())) push(m[1]);

      m = label.match(/^(.+?)的(?:个人)?主页$/);
      if (m?.[1] && !/^(你|我|他|她|其)$/i.test(m[1].trim())) push(m[1]);

      m = label.match(/^(?:Your profile|账号|账户|Account)[:：]\s*(.+)$/i);
      if (m?.[1]) push(m[1]);

      m = label.match(/^Account for (.+)$/i);
      if (m?.[1]) push(m[1]);
    }

    return { displayName: candidates[0] || null, avatarUrl, candidates };
  }, [...NOISE_NAMES]);
}

/**
 * 新版 FB 右上角按钮 aria 常只有 "Your profile"，名字在点开后的账号菜单里
 * （如 "Lune Hale" + "See all profiles"）
 */
async function scrapeNameFromAccountMenu(page) {
  const btn = page
    .locator(
      '[aria-label="Your profile"], [aria-label^="Your profile:"], [aria-label="Account, your profile"], [aria-label^="Account, your profile"], [aria-label*="你的个人主页"]'
    )
    .first();
  if (!(await btn.isVisible({ timeout: 1500 }).catch(() => false))) return null;

  try {
    await btn.click({ timeout: 2500 });
    await page.waitForTimeout(800);
    const name = await page.evaluate((noiseList) => {
      const noise = new Set(noiseList);
      const bad = (t) => {
        const s = String(t || '')
          .trim()
          .toLowerCase();
        if (!s || s.length < 2 || s.length > 60 || noise.has(s)) return true;
        if (/^\d{5,}$/.test(s)) return true;
        if (
          /^(see all|see more|find friends|settings|log out|help|privacy|meta|facebook|messenger|notifications?|your profile|account)/i.test(
            s
          )
        ) {
          return true;
        }
        if (/profile|settings|logout|退出|设置|帮助|隐私|通知|好友/i.test(s) && s.length < 24) {
          return true;
        }
        return false;
      };

      // 优先：紧挨「See all profiles / 查看所有主页」上方的人名
      const markers = [...document.querySelectorAll('span, div, a')].filter((el) => {
        const t = (el.innerText || '').trim();
        return /^(see all profiles|查看所有主页|see all profiles\.?)$/i.test(t);
      });
      for (const mark of markers) {
        let cur = mark.parentElement;
        for (let i = 0; i < 6 && cur; i++) {
          const texts = [...cur.querySelectorAll('span')]
            .map((s) => (s.innerText || '').trim().replace(/\s+/g, ' '))
            .filter((t) => t && !/^see all/i.test(t) && !/^查看所有/i.test(t));
          for (const t of texts) {
            if (!bad(t)) return t;
          }
          cur = cur.parentElement;
        }
      }

      // 次选：菜单里短文本人名（排除 UI 文案）
      const all = [...document.querySelectorAll('[role="dialog"] span, [role="menu"] span, span')]
        .map((el) => (el.innerText || '').trim().replace(/\s+/g, ' '))
        .filter((t) => t && t.length >= 2 && t.length <= 40 && !bad(t));
      // 像 "First Last" 的更靠谱
      const spaced = all.find((t) => /\s/.test(t) && !/\n/.test(t));
      return spaced || all[0] || null;
    }, [...NOISE_NAMES]);

    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(200);
    const cleaned = cleanSelfName(name);
    if (cleaned && !isBadSelfName(cleaned) && !/^\d+$/.test(cleaned)) return cleaned;
    return null;
  } catch {
    await page.keyboard.press('Escape').catch(() => null);
    return null;
  }
}

/**
 * @param {{ fast?: boolean }} [opts]
 *  fast=true：登录收尾用，只读 cookie + DOM，最多试一次短超时下头像，绝不串行 Graph/CDN 重试
 */
async function readProfileFromInbox(page, context, accountId, opts = {}) {
  const fast = !!opts.fast;
  const cUser = await getCUserId(context);
  const info = await scrapeSelfInfoFromPage(page);

  const avatarKey = `account_${accountId}`;
  let avatarUrl = null;
  let selfAvatarRemote = info.avatarUrl;

  if (!isUsableAvatarUrl(selfAvatarRemote)) {
    try {
      const loc = page
        .locator(
          '[aria-label="Your profile"] image, [aria-label="Your profile"] img, [aria-label^="Your profile"] image, [aria-label^="Your profile"] img, [aria-label="Account, your profile"] image, [aria-label="Account, your profile"] img, [aria-label*="你的个人主页"] image, [aria-label*="你的个人主页"] img'
        )
        .first();
      if (await loc.isVisible({ timeout: 1200 }).catch(() => false)) {
        selfAvatarRemote =
          (await loc.getAttribute('xlink:href').catch(() => null)) ||
          (await loc.getAttribute('href').catch(() => null)) ||
          (await loc.getAttribute('src').catch(() => null)) ||
          null;
      }
    } catch {
      /* ignore */
    }
  }

  if (isUsableAvatarUrl(selfAvatarRemote)) {
    if (fast) {
      // 登录阶段：只试一次；失败不删旧缓存，避免头像变空白
      avatarUrl = await Promise.race([
        cacheAvatarViaPageFetch(page, enlargeFbAvatarUrl(selfAvatarRemote), avatarKey),
        new Promise((r) => setTimeout(() => r(null), 8000)),
      ]);
    } else {
      // saveAvatarBuffer 会覆盖写入；不要先 clear，否则下载失败就只剩破链
      avatarUrl = await cacheAvatarViaPageFetch(page, selfAvatarRemote, avatarKey);
      if (!avatarUrl) {
        avatarUrl = await cacheAvatar(context, enlargeFbAvatarUrl(selfAvatarRemote), avatarKey);
      }
      if (!avatarUrl) {
        avatarUrl = await cacheAvatar(context, selfAvatarRemote, avatarKey);
      }
    }
  }

  if (!fast && !avatarUrl && cUser) {
    avatarUrl = await fetchViewerAvatar(context, cUser, avatarKey, page);
  }

  let displayName = null;
  if (!fast && cUser) {
    displayName = await fetchViewerName(context, cUser, page);
  }
  if (!displayName) {
    for (const c of [info.displayName, ...(info.candidates || [])]) {
      const name = cleanSelfName(c);
      if (name && !isBadSelfName(name) && !/^\d+$/.test(name)) {
        displayName = name;
        break;
      }
    }
  }
  // aria 拿不到名字时（常见），点开右上角账号菜单读真实姓名
  if (!displayName) {
    displayName = await scrapeNameFromAccountMenu(page);
  }
  if (!displayName) displayName = cUser || null;

  return {
    username: cUser || null,
    displayName,
    avatarUrl,
  };
}

export async function readProfile(context, opts = {}) {
  const page = context.pages()[0] || (await context.newPage());
  const onInbox = /facebook\.com\/messages|messenger\.com/i.test(page.url());
  // 登录收尾：已在信箱页就别再 goto，避免又撞 PIN / 空白页干等
  if (!onInbox && !opts.fast) {
    await page.goto(FB_MESSAGES, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
    await page.waitForTimeout(1500);
  } else if (!onInbox && opts.fast) {
    await page.goto(FB_MESSAGES, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(800);
  }
  return readProfileFromInbox(page, context, opts.accountId || 'profile', opts);
}

export async function openLoginPage(page) {
  await page.goto(FACEBOOK_LOGIN, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  }).catch(() => null);

  if (!/login|facebook\.com|messenger\.com/i.test(page.url())) {
    await page.goto(MESSENGER_LOGIN, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    }).catch(() => null);
  }

  return {
    phase: 'waiting',
    message: loginHints.waitingMessage,
  };
}

export async function syncMessages(context, accountId) {
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
  const captured = [];
  const onResponse = async (res) => {
    try {
      const url = res.url();
      if (!/graphql|messaging|inbox|thread|conversation|mercury/i.test(url)) return;
      if (!res.ok()) return;
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json') && !ct.includes('javascript') && !ct.includes('text')) return;
      const text = await res.text().catch(() => null);
      if (!text) return;
      try {
        captured.push({ url, json: JSON.parse(text) });
      } catch {
        for (const line of text.split('\n').filter(Boolean)) {
          try {
            captured.push({ url, json: JSON.parse(line) });
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  };
  page.on('response', onResponse);

  const hasInbox = await ensureInboxPage(page);
  // 再等一会儿让列表/头像加载
  await page.waitForTimeout(2000);
  page.off('response', onResponse);

  let profile = null;
  try {
    profile = await readProfileFromInbox(page, context, accountId);
  } catch {
    profile = null;
  }

  if (!hasInbox) {
    return {
      ok: true,
      reason: 'inbox_not_ready',
      conversations: [],
      messages: [],
      profile,
    };
  }

  const fromNetwork = parseNetworkPayloads(captured);
  const fromDom = await scrapeDomConversations(page);
  let merged = mergeConversations(fromNetwork.conversations, fromDom.conversations);
  merged = merged.filter((c) => !isNoiseConversation(c));

  await enrichConversationAvatars(page, context, accountId, merged.slice(0, 30));
  await cacheAvatarsParallel(context, accountId, merged, profile);

  return {
    ok: true,
    reason: fromNetwork.conversations.length
      ? 'network+dom'
      : merged.length
        ? 'dom'
        : 'empty',
    conversations: merged,
    messages: fromNetwork.messages,
    profile,
  };
}

async function enrichConversationAvatars(page, context, accountId, conversations) {
  for (const c of conversations) {
    try {
      const safeId = String(c.peerId).replace(/["\\\]]/g, '');
      const row = page.locator(`a[href*="/t/${safeId}"]`).first();
      if (!(await row.count().catch(() => 0))) continue;

      // 只要列表项里的真人 CDN 图；禁止用 threadId 去 Graph 乱猜（会抓错人）
      const imgs = row.locator('img');
      const imgCount = await imgs.count().catch(() => 0);
      let picked = null;
      for (let i = 0; i < imgCount; i++) {
        const src = await imgs.nth(i).getAttribute('src').catch(() => null);
        if (isUsableAvatarUrl(src)) {
          picked = imgs.nth(i);
          const local = await cacheAvatar(context, src, `${accountId}_peer_${c.peerId}`);
          if (local?.startsWith('/media/')) {
            c.peerAvatar = local;
            break;
          }
        }
      }
      if (c.peerAvatar?.startsWith('/media/')) continue;

      if (picked) {
        const shot = await cacheAvatarFromLocator(
          page,
          picked,
          `${accountId}_peer_${c.peerId}`
        );
        if (shot) c.peerAvatar = shot;
      } else {
        // 截第一张可见图（排除过小 Logo）
        const shot = await cacheAvatarFromLocator(
          page,
          row.locator('img').first(),
          `${accountId}_peer_${c.peerId}`
        );
        if (shot) c.peerAvatar = shot;
      }
    } catch {
      /* next */
    }
  }
}

async function cacheAvatarsParallel(context, accountId, merged, profile) {
  const tasks = [];
  for (const c of merged) {
    if (c.peerAvatar && !c.peerAvatar.startsWith('/media/') && isUsableAvatarUrl(c.peerAvatar)) {
      tasks.push(async () => {
        c.peerAvatar = await cacheAvatar(context, c.peerAvatar, `${accountId}_${c.peerId}`);
      });
    } else if (
      c.peerAvatar &&
      !c.peerAvatar.startsWith('/media/') &&
      !isUsableAvatarUrl(c.peerAvatar)
    ) {
      c.peerAvatar = null;
    }
  }
  if (
    profile?.avatarUrl &&
    !profile.avatarUrl.startsWith('/media/') &&
    isUsableAvatarUrl(profile.avatarUrl)
  ) {
    tasks.push(async () => {
      profile.avatarUrl = await cacheAvatar(context, profile.avatarUrl, `account_${accountId}`);
    });
  }

  const concurrency = 4;
  for (let i = 0; i < tasks.length; i += concurrency) {
    await Promise.all(tasks.slice(i, i + concurrency).map((fn) => fn()));
  }
}

async function scrapeDomConversations(page) {
  const conversations = await page.evaluate((noiseList) => {
    const noise = new Set(noiseList);
    const badges = new Set([
      'message request',
      'message requests',
      '消息请求',
      'active now',
      '在线',
      'reply?',
      'follow up?',
    ]);
    const isNav = (text) => {
      const t = String(text || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      if (!t) return true;
      if (noise.has(t)) return true;
      if (/忘记密码|find friends|skip to |notification|^meta\b|enter your pin/i.test(t)) return true;
      return false;
    };
    const isBadge = (text) => badges.has(String(text || '').trim().toLowerCase());

    const usable = (src) => {
      if (!src || src.startsWith('data:') || src.startsWith('blob:')) return false;
      if (/rsrc\.php|static\.xx\.fbcdn|logo|emoji|sticker/i.test(src)) return false;
      return /scontent|fbcdn\.net|fbsbx/i.test(src);
    };

    /**
     * Facebook 时间常见形态：
     * - 独立一行：`1d` / `20h` / `5m`
     * - 跟在预览后：`You: Hi! … · 1d`（同一行，以前漏解析会退化成「几分钟前」）
     */
    const TIME_UNIT = '(m|min|mins|h|hr|hrs|d|day|days|w|wk|wks|分钟|小时|天|周)';
    const timeFromLine = (line) => {
      const s = String(line || '').trim();
      if (!s) return null;
      if (/^(yesterday|昨天)$/i.test(s)) return { n: 1, u: 'd' };
      let m = s.match(new RegExp(`^(\\d+)\\s*${TIME_UNIT}$`, 'i'));
      if (!m) {
        m = s.match(new RegExp(`[·•\\|\\u00b7]\\s*(\\d+)\\s*${TIME_UNIT}\\s*$`, 'i'));
      }
      if (!m) {
        m = s.match(new RegExp(`(?:^|\\s)(\\d+)\\s*${TIME_UNIT}\\s*$`, 'i'));
      }
      if (!m) return null;
      return { n: Number(m[1]), u: m[2].toLowerCase() };
    };
    const relToMs = (n, u) => {
      if (/^(m|min|mins|分钟)$/i.test(u)) return n * 60 * 1000;
      if (/^(h|hr|hrs|小时)$/i.test(u)) return n * 3600 * 1000;
      if (/^(d|day|days|天)$/i.test(u)) return n * 86400 * 1000;
      if (/^(w|wk|wks|周)$/i.test(u)) return n * 7 * 86400 * 1000;
      return 0;
    };
    const stripTrailingTime = (line) =>
      String(line || '')
        .replace(new RegExp(`[·•\\|\\u00b7]?\\s*\\d+\\s*${TIME_UNIT}\\s*$`, 'i'), '')
        .replace(/\s*[·•|]\s*$/, '')
        .trim();

    const parseRel = (rawLines, index) => {
      const now = Date.now();
      for (const line of rawLines) {
        const hit = timeFromLine(line);
        if (!hit) continue;
        const ms = relToMs(hit.n, hit.u);
        if (ms > 0) {
          // 同一相对时间的会话，用列表序号拉开，保持 Messenger 从上到下顺序
          return new Date(now - ms - index * 1000).toISOString();
        }
      }
      // 没有时间标签：不要瞎写成「几分钟前」（会把 1d 顶到列表最前）
      return null;
    };

    const results = [];
    const seen = new Set();
    const anchors = [
      ...document.querySelectorAll(
        'a[href*="/messages/t/"], a[href*="/messages/e2ee/t/"], a[href*="/t/"]'
      ),
    ];
    let index = 0;
    for (const el of anchors) {
      const href = el.getAttribute('href') || '';
      if (/\/messages\/new/i.test(href)) continue;
      const threadMatch = href.match(/\/t\/([^/?#]+)/);
      if (!threadMatch) continue;
      const peerId = String(threadMatch[1]);
      if (!peerId || seen.has(peerId)) continue;

      const rawLines = (el.innerText || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => !/^·$/.test(s));

      const timeIso = parseRel(rawLines, index);

      const lines = rawLines
        .map(stripTrailingTime)
        .filter(Boolean)
        .filter(
          (s) =>
            !/^\d+\s*(m|min|mins|h|hr|hrs|d|day|days|w|wk|wks|s|分钟|小时|天|周)$/i.test(s) &&
            !/^(Reply\?|Follow up\?|yesterday|昨天)$/i.test(s)
        );

      // 名字：跳过 Message request 等徽章
      let peer = null;
      for (const line of lines) {
        if (isBadge(line) || isNav(line)) continue;
        peer = line;
        break;
      }
      if (!peer) peer = lines.find((l) => !isBadge(l)) || peerId;
      if (isNav(peer) || isBadge(peer)) continue;

      let lastMessage = '';
      for (const line of lines) {
        if (line === peer || isBadge(line) || isNav(line)) continue;
        lastMessage = line;
        break;
      }

      let avatar = null;
      for (const img of el.querySelectorAll('img')) {
        const src = img.currentSrc || img.src || '';
        if (usable(src)) {
          avatar = src;
          break;
        }
      }

      seen.add(peerId);
      results.push({
        peerId,
        peerUsername: peer,
        peerNickname: peer,
        peerAvatar: avatar,
        lastMessage,
        lastMessageAt: timeIso,
        unread: 0,
        _order: index,
      });
      index += 1;
    }
    return results.slice(0, 80);
  }, [...NOISE_NAMES]);

  return { conversations, messages: [] };
}

export function isNoiseConversation(c) {
  const name = c?.peerNickname || c?.peerUsername || '';
  if (isNoiseName(name)) return true;
  if (isNoiseName(c?.lastMessage)) return true;
  if (String(c?.peerId || '').startsWith('dom_')) return true;
  return false;
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function mergeConversations(networkList, domList) {
  const byNick = new Map();
  const byId = new Map();
  for (const c of domList) {
    if (isNoiseConversation(c)) continue;
    byNick.set(norm(c.peerNickname || c.peerUsername), c);
    byId.set(String(c.peerId), c);
  }

  const out = [];
  const used = new Set();

  for (const n of networkList) {
    if (isNoiseConversation(n)) continue;
    const key = norm(n.peerNickname || n.peerUsername);
    const d = byId.get(String(n.peerId)) || byNick.get(key);
    if (d?.peerAvatar && !isUsableAvatarUrl(n.peerAvatar)) n.peerAvatar = d.peerAvatar;
    if (d?.peerAvatar && !n.peerAvatar) n.peerAvatar = d.peerAvatar;
    if (d?.peerNickname && isNoiseName(n.peerNickname)) {
      n.peerNickname = d.peerNickname;
      n.peerUsername = d.peerUsername;
    }
    out.push(n);
    used.add(key);
    used.add(String(n.peerId));
  }

  for (const d of domList) {
    if (isNoiseConversation(d)) continue;
    const key = norm(d.peerNickname || d.peerUsername);
    if (used.has(key) || used.has(String(d.peerId))) continue;
    out.push(d);
  }
  return out;
}

function walk(node, visit, depth = 0) {
  if (depth > 16 || node == null) return;
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

function pickString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function pickAvatar(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const candidates = [
    obj.profile_pic_url,
    obj.profile_pic_large,
    obj.profilePicLarge,
    obj.big_image_src,
    obj.square_image_src,
    obj.profile_picture?.uri,
    obj.profile_picture?.url,
    obj.image?.uri,
    obj.image?.url,
    obj.picture_url,
    obj.avatar_url,
    obj.avatarUrl,
    obj.uri,
    obj.url,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && isUsableAvatarUrl(c)) return c;
  }
  return null;
}

function parseNetworkPayloads(captured) {
  const conversations = [];
  const messages = [];

  for (const { json } of captured) {
    walk(json, (obj) => {
      if (!obj || typeof obj !== 'object') return;

      const threadKey = pickString(
        obj.thread_key,
        obj.threadKey,
        obj.thread_fbid,
        obj.threadFbId,
        obj.thread_id,
        obj.threadId,
        typeof obj.thread_key === 'object' ? obj.thread_key?.thread_fbid : null,
        typeof obj.threadKey === 'object' ? obj.threadKey?.thread_fbid : null
      );

      const nick = pickString(
        obj.name,
        obj.title,
        obj.nickname,
        obj.username,
        obj.short_name,
        obj.shortName,
        obj.display_name,
        obj.displayName
      );

      const snippet = pickString(
        obj.snippet,
        obj.last_message?.snippet,
        obj.lastMessage?.snippet,
        obj.message?.text,
        obj.text,
        obj.body
      );

      const avatar = pickAvatar(obj) || pickAvatar(obj.image) || pickAvatar(obj.profile_picture);

      if (threadKey && nick && nick.length < 120 && !isNoiseName(nick)) {
        conversations.push({
          peerId: String(threadKey),
          peerUsername: nick,
          peerNickname: nick,
          peerAvatar: avatar,
          lastMessage: snippet && !isNoiseName(snippet) ? String(snippet).slice(0, 500) : '',
          lastMessageAt: toIso(
            obj.updated_time ||
              obj.updatedTime ||
              obj.timestamp_precise ||
              obj.timestamp ||
              obj.last_message?.timestamp_precise
          ),
          unread: Number(obj.unread_count || obj.unreadCount || 0) || 0,
        });
      }

      const msgText = pickString(obj.message?.text, obj.text, obj.body, obj.snippet);
      const msgId = pickString(
        obj.message_id,
        obj.messageId,
        obj.mid,
        obj.offline_threading_id,
        obj.offlineThreadingId,
        obj.id
      );
      const ts = obj.timestamp_precise || obj.timestamp || obj.created_time || obj.createdTime;
      if (msgText && msgId && ts) {
        const isSelf =
          obj.is_viewer_sender === true ||
          obj.isViewerSender === true ||
          obj.message_sender?.messaging_actor?.id === obj.viewer_id;
        messages.push({
          id: String(msgId),
          peerId: String(threadKey || obj.thread_id || obj.threadId || 'unknown'),
          direction: isSelf ? 'out' : 'in',
          content: String(msgText).slice(0, 2000),
          messageType: 'text',
          sentAt: toIso(ts),
        });
      }
    });
  }

  const cmap = new Map();
  for (const c of conversations) {
    const prev = cmap.get(c.peerId);
    if (!prev || (!prev.peerAvatar && c.peerAvatar) || (c.lastMessage && !prev.lastMessage)) {
      cmap.set(c.peerId, { ...prev, ...c, peerAvatar: c.peerAvatar || prev?.peerAvatar });
    }
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

export async function sendReply(context, peerUsernameOrId, text) {
  if (!(await isLoggedIn(context))) {
    return { ok: false, reason: 'not_logged_in' };
  }

  const page = context.pages()[0] || (await context.newPage());
  const target = String(peerUsernameOrId);

  if (/^\d+$/.test(target)) {
    const urls = [
      `https://www.facebook.com/messages/t/${encodeURIComponent(target)}/`,
      `https://www.facebook.com/messages/e2ee/t/${encodeURIComponent(target)}/`,
    ];
    let opened = false;
    for (const url of urls) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
      await page.waitForTimeout(2000);
      await waitForPinDialog(page);
      const inputVisible = await page
        .locator('div[contenteditable="true"][role="textbox"], div[aria-label*="Message"][contenteditable="true"]')
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      if (inputVisible) {
        opened = true;
        break;
      }
    }
    if (!opened) {
      await ensureInboxPage(page);
    }
  } else {
    await ensureInboxPage(page);
    await page.waitForTimeout(1000);
    const clicked = await page.evaluate((name) => {
      for (const el of document.querySelectorAll('a[href*="/t/"]')) {
        const t = (el.textContent || '').trim();
        if (t === name || t.startsWith(name + '\n') || (name.length > 2 && t.includes(name))) {
          el.click();
          return true;
        }
      }
      return false;
    }, target);
    if (!clicked) return { ok: false, reason: 'conversation_not_found' };
  }

  await page.waitForTimeout(1500);
  const input = page
    .locator(
      'div[aria-label*="Message"][contenteditable="true"], div[aria-label*="消息"][contenteditable="true"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"]'
    )
    .first();

  if (!(await input.isVisible({ timeout: 5000 }).catch(() => false))) {
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
