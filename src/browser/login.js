import {
  getContext,
  closeContext,
  isLoggedIn,
  readProfile,
  reapplyContextWindow,
  setContextWindowBounds,
} from './manager.js';
import { getPlatform, normalizePlatform } from './platforms/index.js';

/**
 * @typedef {{
 *   phase: 'starting'|'loading'|'waiting'|'logged_in'|'expired'|'error'|'idle',
 *   message: string,
 *   screenshot: string|null,
 *   profile: object|null,
 *   page?: import('playwright-core').Page,
 *   platform?: string,
 *   startedAt: number,
 *   promise?: Promise<void>,
 * }} LoginSession
 */

/** @type {Map<string, LoginSession>} */
const loginSessions = new Map();

function setSession(accountId, patch) {
  const prev = loginSessions.get(accountId) || {
    phase: 'idle',
    message: '',
    screenshot: null,
    profile: null,
    startedAt: Date.now(),
  };
  const next = { ...prev, ...patch };
  loginSessions.set(accountId, next);
  return next;
}

/** Start login in background; returns immediately so UI won't freeze. */
export function startQrLogin(accountId, platformHint = 'tiktok', windowBounds = null) {
  const existing = loginSessions.get(accountId);
  if (existing?.promise) {
    return {
      status: 'starting',
      phase: existing.phase,
      message: existing.message,
      screenshot: existing.screenshot,
      platform: existing.platform,
    };
  }

  const platform = normalizePlatform(platformHint);

  setSession(accountId, {
    phase: 'starting',
    message: '正在启动浏览器…',
    screenshot: null,
    profile: null,
    platform,
    windowBounds: windowBounds || null,
    startedAt: Date.now(),
  });

  const promise = runLoginFlow(accountId, platform).finally(() => {
    const s = loginSessions.get(accountId);
    if (s) delete s.promise;
  });
  setSession(accountId, { promise });

  return {
    status: 'starting',
    phase: 'starting',
    message: '正在启动浏览器…',
    screenshot: null,
    platform,
  };
}

async function runLoginFlow(accountId, platform) {
  const adapter = getPlatform(platform);
  try {
    await closeContext(accountId);
    const windowBounds = loginSessions.get(accountId)?.windowBounds || null;
    setSession(accountId, {
      phase: 'starting',
      message: '正在启动浏览器…',
      platform,
    });

    const context = await getContext(accountId, { headless: false, windowBounds });
    const page = context.pages()[0] || (await context.newPage());
    setSession(accountId, {
      page,
      phase: 'loading',
      message:
        platform === 'facebook'
          ? '正在打开 Facebook / Messenger 登录页…'
          : '正在打开 TikTok 登录页…',
      platform,
    });

    const nav = await adapter.openLoginPage(page);
    await reapplyContextWindow(accountId).catch(() => {});
    await page.bringToFront().catch(() => {});
    setSession(accountId, {
      phase: nav.phase || 'waiting',
      message: nav.message || adapter.loginHints.waitingMessage,
    });

    refreshScreenshot(accountId).catch(() => {});

    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const session = loginSessions.get(accountId);
      if (!session || session.phase === 'error') return;

      if (await isLoggedIn(context, platform)) {
        setSession(accountId, {
          phase: 'loading',
          message: '登录成功，正在提取账号信息…',
        });
        // Facebook 完整读资料会串行下头像/Graph，CDN 超时能卡数分钟；登录只走快路径 + 硬超时
        let profile = await Promise.race([
          readProfile(context, platform, {
            fast: true,
            accountId,
          }).catch(() => null),
          new Promise((resolve) =>
            setTimeout(() => resolve(null), platform === 'facebook' ? 12000 : 25000)
          ),
        ]);
        if (!profile?.username) {
          // 超时也至少带上 cookie 里的用户 id，避免一直卡在「提取账号信息」
          const cookies = await context.cookies().catch(() => []);
          const cUser = cookies.find((c) => c.name === 'c_user')?.value || null;
          profile = {
            username: profile?.username || cUser,
            displayName: profile?.displayName || cUser,
            avatarUrl: profile?.avatarUrl || null,
          };
        }
        setSession(accountId, {
          phase: 'logged_in',
          message: '登录成功',
          profile,
          screenshot: null,
        });
        await closeContext(accountId);
        return;
      }

      await sleep(1500);
      if (Date.now() % 2 === 0) {
        refreshScreenshot(accountId).catch(() => {});
      }
    }

    setSession(accountId, {
      phase: 'expired',
      message:
        platform === 'facebook'
          ? '登录超时，请重新打开并完成登录'
          : '二维码已过期，请重新扫码',
    });
  } catch (e) {
    setSession(accountId, {
      phase: 'error',
      message: e.message || '登录失败',
    });
  }
}

async function refreshScreenshot(accountId) {
  const session = loginSessions.get(accountId);
  if (!session?.page || session.page.isClosed()) return;
  const screenshot = await captureLoginView(session.page);
  const cur = loginSessions.get(accountId);
  if (cur && (cur.phase === 'waiting' || cur.phase === 'loading')) {
    setSession(accountId, { screenshot });
  }
}

export async function getLoginStatus(accountId) {
  const session = loginSessions.get(accountId);
  if (!session) {
    return {
      status: 'idle',
      phase: 'idle',
      message: '',
      profile: null,
      screenshot: null,
      platform: null,
    };
  }

  const base = { platform: session.platform || null };

  if (session.phase === 'logged_in') {
    return {
      ...base,
      status: 'logged_in',
      phase: 'logged_in',
      message: session.message,
      profile: session.profile,
      screenshot: null,
    };
  }

  if (session.phase === 'expired') {
    return {
      ...base,
      status: 'expired',
      phase: 'expired',
      message: session.message,
      profile: null,
      screenshot: session.screenshot,
    };
  }

  if (session.phase === 'error') {
    return {
      ...base,
      status: 'error',
      phase: 'error',
      message: session.message,
      profile: null,
      screenshot: session.screenshot,
    };
  }

  return {
    ...base,
    status: 'waiting',
    phase: session.phase,
    message: session.message,
    profile: null,
    screenshot: session.screenshot,
  };
}

export async function cancelLogin(accountId) {
  const session = loginSessions.get(accountId);
  if (session?.page && !session.page.isClosed()) {
    await session.page.close().catch(() => {});
  }
  loginSessions.delete(accountId);
  await closeContext(accountId);
}

/** Re-measure from UI and re-dock Chrome while login is in progress. */
export async function updateLoginWindowBounds(accountId, windowBounds) {
  const session = loginSessions.get(accountId);
  if (!session) return { ok: false, reason: 'no_session' };
  const bounds = windowBounds || null;
  setSession(accountId, { windowBounds: bounds });
  const ok = await setContextWindowBounds(accountId, bounds);
  return { ok };
}

async function captureLoginView(page) {
  const qr = page
    .locator(
      'canvas, img[alt*="QR"], img[alt*="qr"], div[data-e2e="qr-code"] img, [class*="qrcode"] canvas, [class*="QRCode"] img'
    )
    .first();
  try {
    if (await qr.isVisible({ timeout: 1200 })) {
      const buf = await qr.screenshot({ type: 'jpeg', quality: 72 });
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    }
  } catch {
    /* full page */
  }
  const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
