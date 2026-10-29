import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import db, { profilePath } from '../db.js';
import { requireSystemBrowser } from './system-browser.js';
import { getPlatform, normalizePlatform } from './platforms/index.js';

/** @type {Map<string, import('playwright-core').BrowserContext>} */
const contexts = new Map();
/** @type {Map<string, boolean>} */
const contextHeadless = new Map();
/** @type {Map<string, { x: number, y: number, width: number, height: number }>} */
const contextWindowBounds = new Map();
/** @type {Map<string, string>} proxy fingerprint used when context was launched */
const contextProxyKey = new Map();

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * @param {{ x?: number, y?: number, width?: number, height?: number } | null | undefined} b
 */
function normalizeWindowBounds(b) {
  if (!b) return null;
  const x = Math.round(Number(b.x));
  const y = Math.round(Number(b.y));
  const width = Math.round(Number(b.width));
  const height = Math.round(Number(b.height));
  if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
  if (width < 200 || height < 160) return null;
  return { x, y, width, height };
}

/** Avoid “要恢复页面吗” and last-session window size overriding our place. */
function markProfileCleanExit(dir) {
  const prefsPath = path.join(dir, 'Default', 'Preferences');
  try {
    if (!fs.existsSync(prefsPath)) return;
    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    prefs.profile = prefs.profile || {};
    prefs.profile.exit_type = 'Normal';
    prefs.profile.exited_cleanly = true;
    if (prefs.session) {
      delete prefs.session;
    }
    // Forget last window placement so the next launch doesn't restore a taller frame
    if (prefs.browser?.window_placement) {
      delete prefs.browser.window_placement;
    }
    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch (e) {
    console.warn('[aom] markProfileCleanExit failed:', e?.message || e);
  }
}

/**
 * @param {string} accountId
 * @returns {{ server: string, username?: string, password?: string } | undefined}
 */
function loadAccountProxy(accountId) {
  const row = db
    .prepare(
      `SELECT proxy_server as server, proxy_username as username, proxy_password as password
       FROM accounts WHERE id = ?`
    )
    .get(accountId);
  const server = String(row?.server || '').trim();
  if (!server) return undefined;
  /** @type {{ server: string, username?: string, password?: string }} */
  const proxy = { server };
  const username = String(row?.username || '').trim();
  const password = row?.password != null ? String(row.password) : '';
  if (username) proxy.username = username;
  if (password) proxy.password = password;
  return proxy;
}

function proxyFingerprint(proxy) {
  if (!proxy?.server) return '';
  return `${proxy.server}\0${proxy.username || ''}\0${proxy.password || ''}`;
}

async function launchPersistent(dir, headless, windowBounds, proxy) {
  const browser = requireSystemBrowser();
  const bounds = normalizeWindowBounds(windowBounds);
  if (!headless) {
    markProfileCleanExit(dir);
  }
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    '--disable-session-crashed-bubble',
    '--disable-features=TranslateUI,ChromeWhatsNewUI',
  ];
  if (!headless && bounds) {
    // Only position at launch. Do NOT pass --window-size: Chromium treats it as
    // content size, so outer frame becomes taller than our slot (esp. 2nd+ profiles).
    args.push(`--window-position=${bounds.x},${bounds.y}`);
  }
  // 无账号代理时强制直连，避免吃 Windows「系统代理」；有代理时由 Playwright proxy 接管
  if (!proxy) {
    args.push('--no-proxy-server');
  }
  const base = {
    headless,
    // null = viewport follows real window; avoids setViewportSize stretching the frame
    viewport: bounds ? null : { width: 1400, height: 900 },
    userAgent: USER_AGENT,
    locale: 'zh-CN',
    args,
    ...(proxy ? { proxy } : {}),
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

/**
 * Move the headed Chrome window to the given screen DIP rect (CDP coordinates).
 * Retries because session restore / first paint often fights the first setWindowBounds.
 * @param {import('playwright-core').BrowserContext} context
 * @param {{ x: number, y: number, width: number, height: number } | null | undefined} windowBounds
 */
export async function placeContextWindow(context, windowBounds) {
  const bounds = normalizeWindowBounds(windowBounds);
  if (!bounds || !context) return false;

  let lastErr = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const page = context.pages()[0] || (await context.newPage());
      const session = await context.newCDPSession(page);
      let windowId;
      try {
        const info = await session.send('Target.getTargetInfo');
        const targetId = info?.targetInfo?.targetId;
        const win = await session.send(
          'Browser.getWindowForTarget',
          targetId ? { targetId } : {}
        );
        windowId = win.windowId;
      } catch {
        const win = await session.send('Browser.getWindowForTarget');
        windowId = win.windowId;
      }
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
          windowState: 'normal',
        },
      });
      // Verify position AND size (tight tolerance — 40px slack looked “docked” but visually off)
      const cur = await session.send('Browser.getWindowBounds', { windowId });
      const b = cur?.bounds;
      if (
        b &&
        Math.abs((b.left ?? 0) - bounds.x) < 16 &&
        Math.abs((b.top ?? 0) - bounds.y) < 16 &&
        Math.abs((b.width ?? 0) - bounds.width) < 24 &&
        Math.abs((b.height ?? 0) - bounds.height) < 24
      ) {
        return true;
      }
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 80 + attempt * 40));
  }
  console.warn(
    '[aom] placeContextWindow failed:',
    lastErr?.message || lastErr,
    bounds
  );
  return false;
}

/** Update stored embed bounds and re-dock the headed Chrome window. */
export async function setContextWindowBounds(accountId, windowBounds) {
  const bounds = normalizeWindowBounds(windowBounds);
  if (!bounds) return false;
  const ctx = contexts.get(accountId);
  contextWindowBounds.set(accountId, bounds);
  if (!ctx) return false;
  return placeContextWindow(ctx, bounds);
}

export async function getContext(accountId, { headless = true, windowBounds = null } = {}) {
  const bounds = normalizeWindowBounds(windowBounds);
  const proxy = loadAccountProxy(accountId);
  const proxyKey = proxyFingerprint(proxy);
  if (!headless && !bounds) {
    console.warn(
      '[aom] headed browser without windowBounds — Chrome will open as a free window. Restart Electron so preload (window.aom) is available.'
    );
  }

  if (contexts.has(accountId)) {
    const prev = contextHeadless.get(accountId);
    const sameProxy = contextProxyKey.get(accountId) === proxyKey;
    // Facebook 需要有界面；模式或代理不一致则重建
    if (prev === headless && sameProxy) {
      const ctx = contexts.get(accountId);
      if (!headless && bounds) {
        contextWindowBounds.set(accountId, bounds);
        await placeContextWindow(ctx, bounds);
      }
      return ctx;
    }
    await closeContext(accountId);
  }

  const dir = profilePath(accountId);
  fs.mkdirSync(dir, { recursive: true });

  const context = await launchPersistent(dir, headless, bounds, proxy);

  contexts.set(accountId, context);
  contextHeadless.set(accountId, headless);
  contextProxyKey.set(accountId, proxyKey);
  if (bounds) contextWindowBounds.set(accountId, bounds);
  context.on('close', () => {
    contexts.delete(accountId);
    contextHeadless.delete(accountId);
    contextWindowBounds.delete(accountId);
    contextProxyKey.delete(accountId);
  });

  if (!headless && bounds) {
    await placeContextWindow(context, bounds);
    // Session restore / crash bubble / first paint often fight the first place
    for (const delay of [200, 600, 1200]) {
      setTimeout(() => {
        const b = contextWindowBounds.get(accountId);
        if (b && contexts.get(accountId) === context) {
          placeContextWindow(context, b).catch(() => {});
        }
      }, delay);
    }
  }
  return context;
}

/** Re-apply last known embed bounds (e.g. after navigation). */
export async function reapplyContextWindow(accountId) {
  const ctx = contexts.get(accountId);
  const bounds = contextWindowBounds.get(accountId);
  if (!ctx || !bounds) return false;
  return placeContextWindow(ctx, bounds);
}

export async function closeContext(accountId) {
  const ctx = contexts.get(accountId);
  if (ctx) {
    await ctx.close().catch(() => {});
    contexts.delete(accountId);
    contextHeadless.delete(accountId);
    contextWindowBounds.delete(accountId);
    contextProxyKey.delete(accountId);
  }
}

export async function closeAll() {
  const ids = [...contexts.keys()];
  await Promise.all(ids.map((id) => closeContext(id)));
}

export async function isLoggedIn(context, platform = 'tiktok') {
  return getPlatform(platform).isLoggedIn(context);
}

export async function readProfile(context, platform = 'tiktok', opts = {}) {
  return getPlatform(platform).readProfile(context, opts);
}

export { normalizePlatform, getPlatform };
