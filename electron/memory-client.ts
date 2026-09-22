import { LocalSearchIndex } from './search-index';
import { serveSearch } from './search-mcp';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { memoryConfigSchema, recordSchema } from '../src/shared/memory';
import { iconImportSchema } from '../src/shared/technology-icons';
import { iconDirectory, validateIcon } from './local-icons';

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  const directory = option('--memory-dir') || path.dirname(process.argv[1]);
  const config = memoryConfigSchema.parse(JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8')));
  if (args[0] === 'mcp') { await serveSearch(directory); return; }
  if (args[0] === 'search' || args[0] === 'search-status') {
    const index = new LocalSearchIndex(); await index.load(config);
    const result = args[0] === 'search-status' ? index.status() : await index.search({ query: option('--query') ?? '', kind: (option('--kind') ?? 'all') as 'all', page: Number(option('--page') ?? 1) }, config);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return;
  }
  if (args[0] === 'context') { const state = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')); const catalog = JSON.parse(await readFile(path.join(iconDirectory(directory), 'index.json'), 'utf8')); process.stdout.write(JSON.stringify({ memoryDirectory: directory, sources: config.sources, reportsDirectory: config.reportsDirectory, entities: state.entities, iconsDirectory: iconDirectory(directory), icons: catalog.icons }, null, 2) + '\n'); return; }
  if (!['record', 'icon'].includes(args[0]) || !option('--file')) throw new Error('Usage: node devhaven-memory.cjs context | search --query text [--kind all|document|project] [--page 1] | search-status | mcp | record --file payload.json | icon --name technology --file logo.svg --source https://... [--aliases alias1,alias2] [--memory-dir directory]');
  let record: { id: string };
  if (args[0] === 'icon') {
    const data = await readFile(option('--file')!); validateIcon(data);
    record = iconImportSchema.parse({ type: 'icon', version: 1, id: option('--id') || randomUUID(), name: option('--name'), aliases: (option('--aliases') || '').split(',').map(item => item.trim()).filter(Boolean), sourceUrl: option('--source'), data: data.toString('base64') });
  } else {
    const input = JSON.parse(await readFile(option('--file')!, 'utf8'));
    const change = recordSchema.parse({ version: 1, id: randomUUID(), occurredAt: new Date().toISOString(), evidence: [], ...input });
    if (!config.sources.some(source => source.id === change.sourceId)) throw new Error('Unknown sourceId');
    record = change;
  }
  const inbox = path.join(directory, 'inbox'); await mkdir(inbox, { recursive: true });
  const temporary = path.join(inbox, `${record.id}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
  await rename(temporary, path.join(inbox, `${record.id}.json`));
  process.stdout.write(JSON.stringify({ id: record.id, status: 'queued', receipt: path.join(directory, 'receipts', `${record.id}.json.status`) }) + '\n');
}
void main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
