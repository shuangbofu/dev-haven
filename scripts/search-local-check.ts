import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SearchWorkerClient } from '../electron/search-worker-client';
async function main() {
  const bootstrap = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const config = JSON.parse(await readFile(path.join(bootstrap.memoryDirectory, 'config.json'), 'utf8'));
  const temp = await mkdtemp(path.join(os.tmpdir(), 'devhaven-local-index-'));
  config.directory = temp;
  const worker = new SearchWorkerClient(path.resolve('dist-electron'));
  try {
    const started = performance.now(); await worker.rebuild(config, bootstrap.entities);
    const status = await worker.status();
    const queryStart = performance.now(); const results = await worker.search({ query: 'DevHaven', kind: 'project' }, config);
    console.log(JSON.stringify({ status, buildMs: Math.round(performance.now() - started), queryMs: Math.round(performance.now() - queryStart), projectMatches: results.total, warnings: results.warnings }));
    if (!results.items.some(hit => hit.path.endsWith('devhaven'))) throw new Error('Expected registered project missing');
  } finally { worker.dispose(); await rm(temp, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
