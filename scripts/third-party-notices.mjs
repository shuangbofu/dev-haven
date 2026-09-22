import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function thirdPartyNotices() {
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const sections = ['DevHaven — third-party notices\n\nThird-party names and logos remain the property of their owners.\nJava logo: Devicon (MIT). Maven logo: Apache Maven, https://maven.apache.org/images/logos/MavenLogoLeaf.svg\nElectron runtime licenses and Chromium notices accompany the Electron distribution.\n'];
  for (const [directory, item] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
    if (!directory || item.dev) continue;
    const name = item.name ?? directory.split('node_modules/').at(-1);
    let files;
    try { files = await readdir(directory); } catch (error) { if (error.code === 'ENOENT' && item.optional) continue; throw error; }
    const licenses = files.filter(file => /^(?:licen[cs]e|copying|notice|ofl)(?:[.-].*)?$/i.test(file));
    const contents = [];
    for (const file of licenses) {
      try { contents.push(`${file}\n${await readFile(path.join(directory, file), 'utf8')}`); }
      catch (error) { if (error.code !== 'EISDIR') throw error; }
    }
    sections.push(`${name} ${item.version ?? ''}\nLicense: ${item.license ?? 'See upstream package'}\n${contents.join('\n\n')}`);
  }
  // Devicon's Java graphic is copied as a standalone asset rather than an npm dependency.
  sections.push('Devicon — Java logo\n' + await readFile('public/brands/LICENSE-devicon.txt', 'utf8'));
  return sections.join('\n\n' + '='.repeat(72) + '\n\n') + '\n';
}
