import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../paths.js';

export const avatarsDir = path.join(getDataDir(), 'avatars');
fs.mkdirSync(avatarsDir, { recursive: true });

/** Pull first usable image URL from TikTok-style nested avatar objects. */
export function extractAvatarUrl(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/media/')) return value;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const u = extractAvatarUrl(item);
      if (u) return u;
    }
    return null;
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.url_list) && value.url_list[0]) {
      return extractAvatarUrl(value.url_list[0]);
    }
    const keys = [
      'avatar_thumb',
      'avatarThumb',
      'avatar_medium',
      'avatarMedium',
      'avatar_larger',
      'avatarLarger',
      'avatar_url',
      'avatarUrl',
      'avatar',
      'url',
      'src',
    ];
    for (const k of keys) {
      const u = extractAvatarUrl(value[k]);
      if (u) return u;
    }
  }
  return null;
}

/**
 * Download avatar through the logged-in browser page (has cookies),
 * save locally, return /media/avatars/... for the web UI.
 */
export async function cacheAvatar(context, remoteUrl, key) {
  if (!remoteUrl) return null;
  if (remoteUrl.startsWith('/media/')) return remoteUrl;

  const hash = crypto
    .createHash('sha1')
    .update(String(key || remoteUrl))
    .digest('hex')
    .slice(0, 20);
  const lower = remoteUrl.toLowerCase();
  const ext = lower.includes('.webp')
    ? 'webp'
    : lower.includes('.png')
      ? 'png'
      : lower.includes('.gif')
        ? 'gif'
        : 'jpg';
  const filename = `${hash}.${ext}`;
  const filePath = path.join(avatarsDir, filename);
  const localUrl = `/media/avatars/${filename}`;

  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 100) {
    return localUrl;
  }

  // Open image URL in a tab — TikTok CDN often blocks plain request/fetch
  try {
    const page = await context.newPage();
    try {
      const res = await page.goto(remoteUrl, {
        waitUntil: 'load',
        timeout: 20000,
      });
      if (res && res.ok()) {
        const buf = Buffer.from(await res.body());
        if (buf.length > 50) {
          fs.writeFileSync(filePath, buf);
          return localUrl;
        }
      }
    } finally {
      await page.close().catch(() => {});
    }
  } catch {
    /* keep remote */
  }

  return remoteUrl;
}

/** Screenshot an avatar <img> on the page and save locally (most reliable). */
export async function cacheAvatarFromLocator(page, locator, key) {
  const hash = crypto
    .createHash('sha1')
    .update(String(key))
    .digest('hex')
    .slice(0, 20);
  const filename = `${hash}.jpg`;
  const filePath = path.join(avatarsDir, filename);
  const localUrl = `/media/avatars/${filename}`;

  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 100) {
    return localUrl;
  }

  try {
    const el = locator.first();
    if (!(await el.isVisible({ timeout: 2000 }).catch(() => false))) return null;
    const buf = await el.screenshot({ type: 'jpeg', quality: 85 });
    if (buf.length > 50) {
      fs.writeFileSync(filePath, buf);
      return localUrl;
    }
  } catch {
    return null;
  }
  return null;
}
