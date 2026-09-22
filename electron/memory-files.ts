import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, lstat, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { relativePathSchema, type MemorySource } from '../src/shared/memory';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const slash = (value: string) => value.split(path.sep).join('/');
export const contains = (root: string, target: string) => { const relative = path.relative(root, target); return !relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
export const ignoredDirectories = new Set(['node_modules', 'vendor', 'target', 'dist', 'build', 'out', 'release', '__pycache__', 'venv', 'coverage']);
export async function atomicJSON(file: string, data: unknown) { await atomicText(file, JSON.stringify(data, null, 2) + '\n'); }
export async function atomicText(file: string, content: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
export async function readJSON<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
}
export async function sourcePath(source: MemorySource, relative: string, excluded: string[] = []) {
  relativePathSchema.parse(relative);
  const root = await realpath(source.directory);
  let target = root;
  for (const part of relative.split('/').filter(Boolean)) {
    target = path.join(target, part);
    if ((await lstat(target)).isSymbolicLink()) throw new Error('不允许通过符号链接访问来源');
  }
  target = await realpath(target);
  if (!contains(root, target) || excluded.some(item => contains(item, target)) || source.excludes.some(item => item && (relative === item || relative.startsWith(`${item}/`)))) throw new Error('路径不在允许的来源范围内');
  return target;
}
