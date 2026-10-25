import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function getAppRoot() {
  return projectRoot;
}

export function getPublicDir() {
  return process.env.TTC_PUBLIC_DIR || path.join(projectRoot, 'public');
}

export function getDataDir() {
  const dir = process.env.TTC_DATA_DIR || path.join(projectRoot, 'data');
  fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'avatars'), { recursive: true });
  return dir;
}
