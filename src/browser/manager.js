import { chromium } from 'playwright-core';
import fs from 'fs';
import { profilePath } from '../db.js';
import { requireSystemBrowser } from './system-browser.js';

/** @type {Map<string, import('playwright-core').BrowserContext>} */
const contexts = new Map();

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function launchPersistent(dir, headless) {
  const browser = requireSystemBrowser();
  const base = {
    headless,
    viewport: { width: 1280, height: 800 },
    userAgent: USER_AGENT,
    locale: 'zh-CN',
    args: ['--disable-blink-features=AutomationControlled'],
  };
  try {
    return await chromium.launchPersistentContext(dir, { ...base, channel: browser.channel });
  } catch {
    return chromium.launchPersistentContext(dir, {
      ...base,
      executablePath: browser.executablePath,
    });
  }
}

export async function getContext(accountId, { headless = true } = {}) {
  if (contexts.has(accountId)) {
    return contexts.get(accountId);
  }

  const dir = profilePath(accountId);
  fs.mkdirSync(dir, { recursive: true });

  const context = await launchPersistent(dir, headless);

  contexts.set(accountId, context);
  context.on('close', () => contexts.delete(accountId));
  return context;
}

export async function closeContext(accountId) {
  const ctx = contexts.get(accountId);
  if (ctx) {
    await ctx.close().catch(() => {});
    contexts.delete(accountId);
  }
}

export async function closeAll() {
  const ids = [...contexts.keys()];
  await Promise.all(ids.map((id) => closeContext(id)));
}

export async function isLoggedIn(context) {
  const cookies = await context.cookies('https://www.tiktok.com');
  return cookies.some((c) => c.name === 'sessionid' || c.name === 'sessionid_ss');
}

function pickAvatarField(user) {
  if (!user) return null;
  const candidates = [
    user.avatarThumb,
    user.avatarMedium,
    user.avatarLarger,
    user.avatar_thumb,
    user.avatar_medium,
    user.avatar_larger,
    user.avatarUrl,
    user.avatar_url,
    user.avatar,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === 'string' && c.startsWith('http')) return c;
    if (Array.isArray(c.url_list) && c.url_list[0]) return c.url_list[0];
    if (typeof c.url === 'string') return c.url;
  }
  return null;
}

export async function readProfile(context) {
  const page = context.pages()[0] || (await context.newPage());
  if (!page.url().includes('tiktok.com')) {
    await page.goto('https://www.tiktok.com/foryou', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  }
  await page.waitForTimeout(1500);

  let info = await page.evaluate(() => {
    const next = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
    const out = { username: null, displayName: null, avatarUrl: null, rawUser: null };
    if (next?.textContent) {
      try {
        const data = JSON.parse(next.textContent);
        const scope = data?.__DEFAULT_SCOPE__ || {};
        const user =
          scope['webapp.app-context']?.user ||
          scope['webapp.user-detail']?.userInfo?.user ||
          scope['webapp.app-context']?.userInfo?.user;
        if (user) out.rawUser = user;
      } catch {
        /* ignore */
      }
    }

    const img =
      document.querySelector('[data-e2e="profile-icon"] img') ||
      document.querySelector('img[class*="Avatar"]') ||
      document.querySelector('span[shape="circle"] img') ||
      document.querySelector('a[href*="/@"] img');
    out.avatarUrl = img?.currentSrc || img?.src || null;

    const links = [...document.querySelectorAll('a[href*="/@"]')];
    for (const a of links) {
      const m = a.getAttribute('href')?.match(/\/@([\w.-]+)/);
      if (m) {
        out.username = m[1];
        out.displayName = m[1];
        break;
      }
    }
    return out;
  });

  if (info.rawUser) {
    info = {
      username: info.rawUser.uniqueId || info.rawUser.unique_id || info.username,
      displayName: info.rawUser.nickname || info.displayName,
      avatarUrl: pickAvatarField(info.rawUser) || info.avatarUrl,
    };
  } else {
    info = {
      username: info.username,
      displayName: info.displayName,
      avatarUrl: info.avatarUrl,
    };
  }

  // Still missing username → open profile shortcut if present
  if (!info.username || !info.avatarUrl) {
    const profileHref = await page
      .locator('a[href^="/@"]')
      .first()
      .getAttribute('href')
      .catch(() => null);
    if (profileHref && profileHref.startsWith('/@')) {
      await page.goto(`https://www.tiktok.com${profileHref}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(1500);
      const more = await page.evaluate(() => {
        const next = document.querySelector('#__UNIVERSAL_DATA_FOR_REHYDRATION__');
        try {
          const data = JSON.parse(next?.textContent || '{}');
          const user =
            data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user;
          return user || null;
        } catch {
          return null;
        }
      });
      if (more) {
        info.username = more.uniqueId || more.unique_id || info.username;
        info.displayName = more.nickname || info.displayName;
        info.avatarUrl = pickAvatarField(more) || info.avatarUrl;
      }
    }
  }

  return info;
}
