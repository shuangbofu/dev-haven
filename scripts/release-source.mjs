import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Explicit allowlist: local screenshots, history, memory and build outputs never enter the export.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'release', 'source');
const entries = ['src', 'electron', 'scripts', 'tests', 'skills', 'public', '.github', '.gitattributes', '.gitignore', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', 'MACOS-BUILD.md', 'package.json', 'package-lock.json', 'next.config.ts', 'next-env.d.ts', 'postcss.config.mjs', 'tsconfig.json', 'components.json'];
const home = os.homedir();
const blockedName = /^(?:\.env(?:\..*)?|\.DS_Store|\.npmrc|\.git|node_modules|id_rsa|id_ed25519)$|\.(?:pem|key|p12|pfx|log|tsbuildinfo|map)$/i;
const secrets = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /\bgithub_pat_[A-Za-z0-9_]{50,}\b/, /\bAKIA[0-9A-Z]{16}\b/, /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{40,}\b/, /https?:\/\/[^\s/:]+:[^\s/@]+@/];
const files = [];
const issues = [];
async function inspect(relative) {
  if (path.basename(relative) === '__pycache__' || /\.py[co]$/.test(relative)) return;
  const source = path.join(root, relative);
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) { issues.push(`${relative}: symbolic link`); return; }
  if (blockedName.test(path.basename(source))) { issues.push(`${relative}: excluded filename`); return; }
  if (stat.isDirectory()) {
    for (const child of (await readdir(source)).sort()) await inspect(path.join(relative, child));
    return;
  }
  if (!stat.isFile()) { issues.push(`${relative}: not a regular file`); return; }
  const data = await readFile(source);
  if (home.length > 3 && [home, home.replaceAll('\\', '/'), home.replaceAll('\\', '\\\\')].some(value => data.includes(Buffer.from(value)))) issues.push(`${relative}: current user's home path`);
  if (!data.includes(0)) {
    const text = data.toString('utf8');
    if (secrets.some(pattern => pattern.test(text))) issues.push(`${relative}: credential pattern`);
  }
  files.push(relative);
}
for (const entry of entries) await inspect(entry);
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
for (const [name, item] of Object.entries(lock.packages ?? {})) {
  if (item.resolved && !item.resolved.startsWith('https://registry.npmjs.org/')) issues.push(`package-lock.json: non-public-registry resolution in ${name}`);
}
if (issues.length) throw new Error(`Source export stopped; review these files (values withheld):\n${issues.join('\n')}`);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const relative of files) {
  await mkdir(path.dirname(path.join(destination, relative)), { recursive: true });
  await cp(path.join(root, relative), path.join(destination, relative));
}
await writeFile(path.join(destination, 'SOURCE-MANIFEST.json'), JSON.stringify({ format: 1, files: files.map(file => file.split(path.sep).join('/')) }, null, 2) + '\n');
console.log(`Source export: release/source (${files.length} files). Credential/home-path/registry checks passed. Review content before publishing; this scan cannot detect every private detail.`);
