import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { MemorySource } from '../src/shared/memory';
import { digest, ignoredDirectories, sourcePath } from './memory-files';

export interface ScanCandidate { path: string; fingerprint: string; files: { path: string; modified: string }[]; samples: { path: string; content: string }[]; suggestedKind: 'project' | 'collection' }
export async function scanInventory(source: MemorySource, exclusions: string[], signal: AbortSignal) {
  const candidates: ScanCandidate[] = [], warnings: string[] = [];
  let visited = 0, textBytes = 0;
  const walk = async (relative: string, depth: number) => {
    if (signal.aborted) throw new Error('扫描已取消');
    if (++visited > 5000 || depth > 10 || candidates.length >= 500) { warnings.push(`扫描范围达到上限：${relative}`); return; }
    let directory: string;
    try { directory = await sourcePath(source, relative, exclusions); } catch { return; }
    const names = await readdir(directory, { withFileTypes: true });
    const project = source.kind === 'projects' && names.some(item => ['.git', 'package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'pom.xml', 'build.gradle'].includes(item.name));
    const files: ScanCandidate['files'] = [], samples: ScanCandidate['samples'] = [];
    const collect = async (dir: string, rel: string, level: number) => {
      const priority = (name: string) => /^readme/i.test(name) ? 0 : /^(package\.json|go\.mod|pyproject\.toml|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?)$/i.test(name) ? 1 : 2;
      for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => Number(a.isDirectory()) - Number(b.isDirectory()) || priority(a.name) - priority(b.name) || a.name.localeCompare(b.name))) {
        if (signal.aborted) throw new Error('扫描已取消');
        if (item.isSymbolicLink() || item.name.startsWith('.') || ignoredDirectories.has(item.name) || /(?:lock\.(?:json|yaml)|package-lock\.json|\.lock)$/.test(item.name)) continue;
        const child = path.join(dir, item.name), childRelative = [rel, item.name].filter(Boolean).join('/');
        try { await sourcePath(source, childRelative, exclusions); } catch { continue; }
        if (files.length >= 3000) { warnings.push(`文件指纹达到上限：${relative}`); return; }
        if (item.isDirectory() && project && level < 5) await collect(child, childRelative, level + 1);
        else if (item.isFile()) {
          const info = await stat(child); files.push({ path: childRelative, modified: `${info.mtime.toISOString()}|${info.size}` });
          const rootDocument = level === 0 && /^(?:readme.*\.(?:md|rst|txt)|package\.json|go\.mod|pyproject\.toml|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?|.*\.md)$/i.test(item.name);
          const implementation = project && level <= 2 && /\.(?:tsx?|jsx?|py|go|rs|java|kt)$/i.test(item.name) && !/(?:test|spec|config)/i.test(item.name);
          if ((rootDocument || implementation) && !/^(?:change?logs?\.md|AGENTS\.md|SKILL\.md)$/i.test(item.name) && info.size <= 128 * 1024 && samples.length < 6 && textBytes < 3_000_000) {
            const content = (await readFile(child, 'utf8')).slice(0, 12000); textBytes += content.length; samples.push({ path: childRelative, content });
          }
        }
      }
    };
    await collect(directory, relative, 0);
    if (project || source.kind === 'knowledge' && files.some(file => /\.(md|markdown|txt)$/i.test(file.path))) candidates.push({ path: relative, fingerprint: digest(JSON.stringify(files)), files, samples, suggestedKind: project ? 'project' : 'collection' });
    if (project) return;
    for (const item of names) if (item.isDirectory() && !item.isSymbolicLink() && !item.name.startsWith('.') && !ignoredDirectories.has(item.name)) await walk([relative, item.name].filter(Boolean).join('/'), depth + 1);
  };
  await walk('', 0);
  return { candidates, warnings: [...new Set(warnings)].slice(0, 100) };
}
