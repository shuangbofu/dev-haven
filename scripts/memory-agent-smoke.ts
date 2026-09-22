import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, realpath, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MemoryService } from '../electron/memory';
import { localDate } from '../src/shared/memory';

async function main() {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'devhaven-agent-smoke-')));
  const projectRoot = path.join(temp, 'projects');
  await mkdir(path.join(projectRoot, 'Example'), { recursive: true });
  await writeFile(path.join(projectRoot, 'Example/package.json'), JSON.stringify({ name: 'example', description: 'A TypeScript calculator', scripts: { test: 'node --test' } }));
  await writeFile(path.join(projectRoot, 'Example/README.md'), '# Example\n\nA TypeScript calculator. No service or preview server.');
  const service = await new MemoryService(path.join(temp, 'storage'), path.resolve('dist-electron')).init();
  try {
    const sourceId = randomUUID();
    await service.saveConfig({ ...service.config, initialized: true, agent: { executable: process.env.DEVHAVEN_CODEX_EXECUTABLE || 'codex', model: '' }, sources: [{ id: sourceId, name: 'Fixture', kind: 'projects', directory: projectRoot, scan: true, excludes: [] }] });
    let seen = '';
    service.on('change', () => { const task = service.snapshot().tasks[0]; const status = task && `${task.kind}: ${task.status}: ${task.logs.at(-1) || task.error || ''}`; if (status && status !== seen) { console.log(status); seen = status; } });
    const scan = service.scan(sourceId); await service.idle();
    assert.equal(service.snapshot().tasks.find(task => task.id === scan)?.status, 'success', service.snapshot().tasks.find(task => task.id === scan)?.error);
    assert.ok(service.snapshot().entities.some(entity => entity.path === 'Example' && entity.metadata.kind === 'project'));
    const entity = service.snapshot().entities.find(entity => entity.path === 'Example')!;
    assert.match(entity.metadata.name, /[\u3400-\u9fff]/);
    assert.match(entity.metadata.description, /[\u3400-\u9fff]/);
    assert.equal(entity.registration, 'scan');
    assert.ok(entity.metadataEvidence?.length);
    console.log(JSON.stringify({ name: entity.metadata.name, description: entity.metadata.description, evidence: entity.metadataEvidence }));
    assert.equal(service.snapshot().events.length, 0);
    const recordId = randomUUID(), payload = path.join(temp, 'record.json');
    await writeFile(payload, JSON.stringify({ version: 1, id: recordId, sourceId, path: 'Example', occurredAt: new Date().toISOString(), message: 'Created the example calculator manifest and README.', evidence: ['Example/README.md'] }));
    await promisify(execFile)(process.execPath, [service.snapshot().clientFile, 'record', '--file', payload]);
    await service.consumeInbox();
    assert.equal(JSON.parse(await readFile(path.join(service.config.directory, 'receipts', `${recordId}.json.status`), 'utf8')).accepted, true);
    const report = service.report(localDate()); await service.idle();
    assert.equal(service.snapshot().tasks.find(task => task.id === report)?.status, 'success', service.snapshot().tasks.find(task => task.id === report)?.error);
    assert.ok(service.snapshot().reports[0].evidenceIds.includes(recordId));
    console.log('PASS: actual Codex scan, CLI receipt and evidence-backed daily report');
    await rm(temp, { recursive: true, force: true });
  } catch (error) { console.error(`Fixture retained: ${temp}`); throw error; }
  finally { service.stop(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
