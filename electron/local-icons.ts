import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { atomicJSON, readJSON } from './memory-files';
import { iconDetailsSchema, iconImportSchema, iconName, type IconImport, type LocalIcon } from '../src/shared/technology-icons';

const storedSchema = iconDetailsSchema.extend({ file: z.string().regex(/^[a-f0-9]{64}\.(svg|png)$/) }).strict();
const indexSchema = z.object({ version: z.literal(1), icons: z.array(storedSchema).max(2000) }).strict();
export const iconDirectory = (memory: string) => path.join(memory, 'icons');
export function validateIcon(data: Buffer) {
  if (!data.length || data.length > 512 * 1024) throw new Error('图标必须小于 512 KB');
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (data.length < 33 || data.toString('ascii', 12, 16) !== 'IHDR' || !data.readUInt32BE(16) || !data.readUInt32BE(20) || data.readUInt32BE(16) > 4096 || data.readUInt32BE(20) > 4096) throw new Error('PNG 图标尺寸或格式无效');
    return 'png' as const;
  }
  const svg = data.toString('utf8').trim().replace(/^<\?xml[^>]*\?>\s*/i, '').replace(/<!--[\s\S]*?-->/g, '');
  if (!/^<svg(?:\s|>)/i.test(svg) || !/<\/svg>\s*$/i.test(svg) || /<!|<\?|\bon[a-z]+\s*=|\bhref\s*=|\burl\s*\(|@import|javascript:/i.test(svg)) throw new Error('请提供自包含的静态 SVG 或 PNG 图标');
  const tags = [...svg.matchAll(/<\/?([\w:.-]+)/g)].map(match => match[1].toLowerCase());
  if (tags.some(tag => !['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'title', 'desc', 'defs', 'lineargradient', 'radialgradient', 'stop'].includes(tag))) throw new Error('SVG 含有不支持的动态或外部内容，请使用 PNG');
  return 'svg' as const;
}
async function readIndex(memory: string) {
  const directory = iconDirectory(memory);
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('图标目录不能是符号链接');
  const file = path.join(directory, 'index.json');
  const info = await lstat(file).catch(() => undefined);
  if (info && (!info.isFile() || info.size > 2 * 1024 * 1024)) throw new Error('图标索引格式无效');
  return indexSchema.parse(await readJSON(file, { version: 1, icons: [] }));
}
export async function installIcons(memory: string, inputs: IconImport[], onlyMissing = false) {
  const index = await readIndex(memory);
  for (const raw of inputs) {
    const input = iconImportSchema.parse(raw), key = iconName(input.name);
    if (onlyMissing && index.icons.some(icon => [icon.name, ...icon.aliases].some(name => iconName(name) === key))) continue;
    if (index.icons.some(icon => iconName(icon.name) !== key && [icon.name, ...icon.aliases].some(name => [input.name, ...input.aliases].some(alias => iconName(alias) === iconName(name))))) throw new Error(`图标名称或别名已被使用：${input.name}`);
    const data = Buffer.from(input.data, 'base64'), extension = validateIcon(data);
    const file = `${createHash('sha256').update(data).digest('hex')}.${extension}`;
    try { await writeFile(path.join(iconDirectory(memory), file), data, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = path.join(iconDirectory(memory), file), info = await lstat(existing);
      if (!info.isFile() || info.size !== data.length || !(await readFile(existing)).equals(data)) throw new Error('本地图标文件冲突');
    }
    index.icons = [...index.icons.filter(icon => iconName(icon.name) !== key), { name: input.name, aliases: input.aliases, sourceUrl: input.sourceUrl, file }];
  }
  await atomicJSON(path.join(iconDirectory(memory), 'index.json'), index);
  return loadIcons(memory);
}
export async function loadIcons(memory: string): Promise<LocalIcon[]> {
  const index = await readIndex(memory);
  return Promise.all(index.icons.map(async icon => {
    const file = path.join(iconDirectory(memory), icon.file), info = await lstat(file);
    if (!info.isFile() || info.size > 512 * 1024) throw new Error('本地图标文件无效');
    const data = await readFile(file), extension = validateIcon(data);
    if (`${createHash('sha256').update(data).digest('hex')}.${extension}` !== icon.file) throw new Error('本地图标内容与索引不一致');
    return { name: icon.name, aliases: icon.aliases, sourceUrl: icon.sourceUrl, dataUrl: `data:image/${extension === 'svg' ? 'svg+xml' : 'png'};base64,${data.toString('base64')}` };
  }));
}
