import { getContext, closeContext, isLoggedIn, readProfile } from './manager.js';

/**
 * @typedef {{
 *   phase: 'starting'|'loading'|'waiting'|'logged_in'|'expired'|'error'|'idle',
 *   message: string,
 *   screenshot: string|null,
 *   profile: object|null,
 *   page?: import('playwright-core').Page,
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
export function startQrLogin(accountId) {
  const existing = loginSessions.get(accountId);
  if (existing?.promise) {
    return {
      status: 'starting',
      phase: existing.phase,
      message: existing.message,
      screenshot: existing.screenshot,
    };
  }

  setSession(accountId, {
    phase: 'starting',
    message: '正在启动浏览器…',
    screenshot: null,
    profile: null,
    startedAt: Date.now(),
  });

  const promise = runLoginFlow(accountId).finally(() => {
    const s = loginSessions.get(accountId);
    if (s) delete s.promise;
  });
  setSession(accountId, { promise });

  return {
    status: 'starting',
    phase: 'starting',
    message: '正在启动浏览器…',
    screenshot: null,
  };
}

async function runLoginFlow(accountId) {
  try {
    await closeContext(accountId);
    setSession(accountId, {
      phase: 'starting',
      message: '正在启动浏览器…',
    });

    // 有界面窗口：可直接扫弹出的 Chrome，不必等截图回传
    const context = await getContext(accountId, { headless: false });
    const page = context.pages()[0] || (await context.newPage());
    setSession(accountId, {
      page,
      phase: 'loading',
      message: '正在打开 TikTok 登录页…',
    });

    await page.goto('https://www.tiktok.com/login/qrcode', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    }).catch(() => null);

    // 备用入口
    if (!page.url().includes('login')) {
      await page.goto('https://www.tiktok.com/login', {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
    }

    // 尽量点到二维码方式
    const qrSwitch = page.getByText(/二维码|QR Code|扫码登录|使用二维码/, { exact: false }).first();
    if (await qrSwitch.isVisible({ timeout: 2500 }).catch(() => false)) {
      await qrSwitch.click().catch(() => {});
    }

    await page.bringToFront().catch(() => {});
    setSession(accountId, {
      phase: 'waiting',
      message: '请在弹出的浏览器窗口中扫码（也可看下方预览）',
    });

    // 异步截图，不阻塞「可扫码」状态
    refreshScreenshot(accountId).catch(() => {});

    const deadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < deadline) {
      const session = loginSessions.get(accountId);
      if (!session || session.phase === 'error') return;

      if (await isLoggedIn(context)) {
        setSession(accountId, {
          phase: 'loading',
          message: '登录成功，正在读取账号信息…',
        });
        const profile = await readProfile(context).catch(() => ({
          username: null,
          displayName: null,
          avatarUrl: null,
        }));
        setSession(accountId, {
          phase: 'logged_in',
          message: '登录成功',
          profile,
          screenshot: null,
        });
        // 关掉可见窗口，后续同步用无头模式更省资源
        await closeContext(accountId);
        return;
      }

      await sleep(1500);
      // 偶尔刷新预览图（二维码会过期刷新）
      if (Date.now() % 2 === 0) {
        refreshScreenshot(accountId).catch(() => {});
      }
    }

    setSession(accountId, {
      phase: 'expired',
      message: '二维码已过期，请重新扫码',
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
    };
  }

  if (session.phase === 'logged_in') {
    return {
      status: 'logged_in',
      phase: 'logged_in',
      message: session.message,
      profile: session.profile,
      screenshot: null,
    };
  }

  if (session.phase === 'expired') {
    return {
      status: 'expired',
      phase: 'expired',
      message: session.message,
      profile: null,
      screenshot: session.screenshot,
    };
  }

  if (session.phase === 'error') {
    return {
      status: 'error',
      phase: 'error',
      message: session.message,
      profile: null,
      screenshot: session.screenshot,
    };
  }

  return {
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
