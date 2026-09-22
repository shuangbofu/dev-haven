import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const candidates = process.env.DEVHAVEN_MEMORY_CONFIG
  ? [process.env.DEVHAVEN_MEMORY_CONFIG]
  : [path.join(os.homedir(), '.devHaven', 'memory-config.json')];
let found = false;
for (const file of candidates) {
  try {
    const config = JSON.parse(await readFile(file, 'utf8'));
    if (config.version !== 1 || !path.isAbsolute(config.directory)) throw new Error('Unsupported memory configuration');
    const state = JSON.parse(await readFile(path.join(config.directory, 'state.json'), 'utf8'));
    const iconsDirectory = path.join(config.directory, 'icons');
    const catalog = JSON.parse(await readFile(path.join(iconsDirectory, 'index.json'), 'utf8'));
    console.log(JSON.stringify({ clientFile: path.join(config.directory, 'devhaven-memory.cjs'), memoryDirectory: config.directory, sources: config.sources, reportsDirectory: config.reportsDirectory, entities: state.entities, iconsDirectory, icons: catalog.icons }, null, 2));
    found = true;
    break;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
if (!found) { console.error('DevHaven memory is not initialized. Configure sources in the app, or set DEVHAVEN_MEMORY_CONFIG to its bootstrap configuration file.'); process.exitCode = 1; }
