import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EnvironmentService } from '../electron/service';

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'devhaven-integration-'));
  console.log(`Isolated integration workspace: ${root}`);
  let passed = false;
  try {
    const source = await new EnvironmentService(path.join(root, 'source')).init();
    if (process.env.DEVHAVEN_TEST_ENGINE) await copyFile(process.env.DEVHAVEN_TEST_ENGINE, source.engine.binary);
    let previous = '';
    source.on('change', state => { const current = state.tasks[0]; const message = current?.logs.at(-1); if (message && message !== previous) { console.log(message); previous = message; } });
    await source.bootstrap(); await source.idle();
    assert.equal(source.tasks[0].status, 'success', source.tasks[0].error);
    console.log('PASS: verified engine bootstrap');
    for (const version of ['22.14.0', '20.19.0']) { await source.install('node', version); await source.idle(); assert.equal(source.tasks[0].status, 'success', source.tasks[0].error); }
    assert.equal(source.installations.length, 2);
    assert.equal(source.installations.find(i => i.isDefault)?.version, '22.14.0');
    assert.equal(await source.engine.exec(['exec', '--', 'node', '--version']), 'v22.14.0');
    const older = source.installations.find(i => i.version === '20.19.0')!;
    await source.setDefault(older.id); await source.idle();
    assert.equal(await source.engine.exec(['exec', '--', 'node', '--version']), 'v20.19.0');
    console.log('PASS: install, executable paths and default switching');
    await source.install('pnpm', '10.6.0'); await source.idle();
    assert.equal(source.tasks[0].status, 'success', source.tasks[0].error);
    assert.equal(await source.engine.exec(['exec', '--', 'pnpm', '--version']), '10.6.0');
    console.log('PASS: npm-backed package manager with managed Node');
    const manifest = source.manifest('Integration environment');
    assert.ok(!JSON.stringify(manifest).includes(root));
    assert.equal(manifest.tools.length, 3);
    const destination = await new EnvironmentService(path.join(root, 'destination')).init();
    await copyFile(source.engine.binary, destination.engine.binary);
    destination.engineReady = true;
    const plan = destination.previewImport(manifest);
    assert.equal(plan.items.filter(i => i.action === 'install').length, 3);
    await destination.applyImport(manifest); await destination.idle();
    assert.ok(destination.tasks.every(t => t.status === 'success'), JSON.stringify(destination.tasks.map(t => [t.status, t.error])));
    assert.equal(await destination.engine.exec(['exec', '--', 'node', '--version']), 'v20.19.0');
    assert.equal(await destination.engine.exec(['exec', '--', 'pnpm', '--version']), '10.6.0');
    console.log('PASS: export and rebuild in a fresh environment');
    const reloaded = await new EnvironmentService(source.root).init();
    assert.equal(reloaded.installations.length, 3);
    assert.equal(reloaded.installations.find(i => i.tool === 'node' && i.isDefault)?.version, '20.19.0');
    await reloaded.uninstall(reloaded.installations.find(i => i.tool === 'pnpm')!.id); await reloaded.idle();
    assert.equal(reloaded.tasks[0].status, 'success', reloaded.tasks[0].error);
    assert.equal(reloaded.installations.filter(i => i.tool === 'pnpm').length, 0);
    await reloaded.uninstall(reloaded.installations.find(i => i.version === '20.19.0')!.id); await reloaded.idle();
    assert.equal(await reloaded.engine.exec(['exec', '--', 'node', '--version']), 'v22.14.0');
    console.log('PASS: restart reconciliation, uninstall and default fallback');
    const stateFile = path.join(reloaded.root, 'state.json');
    const state = JSON.parse(await readFile(stateFile, 'utf8')); state.tasks[0].status = 'running';
    await writeFile(stateFile, JSON.stringify(state));
    const recovered = await new EnvironmentService(reloaded.root).init();
    assert.equal(recovered.tasks[0].status, 'failed'); assert.match(recovered.tasks[0].error!, /中断/);
    console.log('PASS: interrupted task recovery');
    passed = true;
  } finally {
    if (passed) { await rm(root, { recursive: true, force: true }); console.log('Cleaned isolated environments. All integration checks passed.'); }
    else console.error(`Preserved failed test workspace for diagnosis: ${root}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
