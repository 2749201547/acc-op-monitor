import { getContext, closeContext, reapplyContextWindow } from './manager.js';
import { getPlatform, normalizePlatform } from './platforms/index.js';
import db from '../db.js';
import * as tiktok from './platforms/tiktok.js';
import * as facebook from './platforms/facebook.js';

function resolvePlatform(accountId) {
  const row = db.prepare('SELECT platform FROM accounts WHERE id = ?').get(accountId);
  return normalizePlatform(row?.platform);
}

/**
 * Facebook 无头模式常被拦成空白页/营销页，同步与回复改用有界面浏览器。
 */
function headlessFor(platform) {
  return platform !== 'facebook';
}

/**
 * Sync inbox for an account using its platform adapter.
 * @param {string} accountId
 * @param {{ windowBounds?: { x: number, y: number, width: number, height: number } | null }} [opts]
 */
export async function syncAccountMessages(accountId, opts = {}) {
  const platform = resolvePlatform(accountId);
  const adapter = getPlatform(platform);
  const headless = headlessFor(platform);
  const windowBounds = opts.windowBounds || null;
  if (!headless) {
    // 确保不是之前残留的无头上下文
    await closeContext(accountId);
  }
  const context = await getContext(accountId, { headless, windowBounds });
  if (!headless && windowBounds) {
    await reapplyContextWindow(accountId).catch(() => {});
  }
  try {
    return await adapter.syncMessages(context, accountId);
  } finally {
    // 有界面同步：每个账号用完就关窗，避免串行同步时旧窗残留、新窗被撑高
    if (!headless) {
      await closeContext(accountId).catch(() => {});
    }
  }
}

export function isNoiseConversation(c, platform) {
  if (platform) {
    return getPlatform(platform).isNoiseConversation(c);
  }
  return tiktok.isNoiseConversation(c) || facebook.isNoiseConversation(c);
}

export async function sendReply(accountId, peerUsernameOrId, text, opts = {}) {
  const platform = resolvePlatform(accountId);
  const adapter = getPlatform(platform);
  const headless = headlessFor(platform);
  const windowBounds = opts.windowBounds || null;
  if (!headless) {
    await closeContext(accountId);
  }
  const context = await getContext(accountId, { headless, windowBounds });
  return adapter.sendReply(context, peerUsernameOrId, text);
}
