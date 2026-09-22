import { thirdPartyNotices } from './third-party-notices.mjs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
const source = JSON.parse(await readFile('package.json', 'utf8'));
await rm('build/app', { recursive: true, force: true });
await mkdir('build/app', { recursive: true });
await cp('out', 'build/app/out', { recursive: true });
await cp('dist-electron', 'build/app/dist-electron', { recursive: true });
const { name, version, description, author, license, main } = source;
await writeFile('build/app/package.json', JSON.stringify({ name, version, description, author, license, main }, null, 2));

await cp('LICENSE', 'build/app/LICENSE');
await writeFile('build/app/THIRD-PARTY-NOTICES.txt', await thirdPartyNotices());
