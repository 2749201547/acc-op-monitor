import * as tiktok from './tiktok.js';
import * as facebook from './facebook.js';

export const PLATFORMS = ['tiktok', 'facebook'];

const adapters = {
  tiktok,
  facebook,
};

export function normalizePlatform(platform) {
  const p = String(platform || 'tiktok').toLowerCase();
  return adapters[p] ? p : 'tiktok';
}

export function getPlatform(platform) {
  return adapters[normalizePlatform(platform)];
}

export function platformLabel(platform) {
  const map = { tiktok: 'TikTok', facebook: 'Facebook' };
  return map[normalizePlatform(platform)] || 'TikTok';
}
