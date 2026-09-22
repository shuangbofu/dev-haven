import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EnvironmentService } from '../electron/service';
import { ShellIntegration } from '../electron/shell-integration';
import { run } from '../electron/process';

async function main() {
if (process.platform !== 'darwin') throw new Error('Run this test on macOS');
if (!process.env.DEVHAVEN_TEST_ENGINE) throw new Error('Set DEVHAVEN_TEST_ENGINE to a real mise executable');
const directory = await mkdtemp(path.join(os.tmpdir(), 'devhaven-global-smoke-'));
const userDirectory = path.join(directory, "user's home $literal");
const root = path.join(userDirectory, '.devhaven');
let passed = false;
try {
  await mkdir(userDirectory);
  const service = await new EnvironmentService(root).init();
  await copyFile(process.env.DEVHAVEN_TEST_ENGINE, service.engine.binary);
  await chmod(service.engine.binary, 0o755);
  const shell = new ShellIntegration(root, { home: userDirectory, zdotdir: userDirectory });
  // Real mise resolves two local fixture tools without network downloads.
  for (const [version, marker] of [['22.0.0', 'fixture-node-22'], ['24.0.0', 'fixture-node-24']]) {
    const location = path.join(directory, `node-${version}`);
    await mkdir(path.join(location, 'bin'), { recursive: true });
    await writeFile(path.join(location, 'bin', 'node'), `#!/bin/sh\nprintf '%s\\n' '${marker}'\n`, { mode: 0o755 });
    await service.engine.exec(['link', `node@${version}`, location]);
    service.installations.push({ id: version, tool: 'node', version, path: location, binPaths: [path.join(location, 'bin')], installedAt: new Date().toISOString(), isDefault: false });
  }
  await service.setDefault('22.0.0'); await service.idle();
  assert.equal(service.tasks[0].status, 'success', service.tasks[0].error);
  await shell.setEnabled(true);
  const freshShell = (command: string) => run('/bin/zsh', ['-lic', command], {
    cwd: userDirectory, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ZDOTDIR: userDirectory, TERM: 'dumb', NODE_ENV: 'test' }, timeout: 20_000,
  });
  assert.equal(await freshShell('node'), 'fixture-node-22');
  assert.equal(await freshShell('print -r -- "$MISE_DATA_DIR"'), path.join(root, 'data'));
  assert.equal(await freshShell('print -r -- "$CARGO_HOME"'), path.join(root, 'cargo'));
  const configBefore = await readFile(path.join(userDirectory, '.zshrc'), 'utf8');
  await service.setDefault('24.0.0'); await service.idle();
  assert.equal(await freshShell('node'), 'fixture-node-24');
  assert.equal(await readFile(path.join(userDirectory, '.zshrc'), 'utf8'), configBefore, 'Switching defaults must not rewrite startup files');
  const reloaded = await new EnvironmentService(root).init();
  assert.equal(reloaded.installations.find(item => item.isDefault)?.version, '24.0.0');
  assert.equal(await freshShell('node'), 'fixture-node-24');
  await shell.setEnabled(false);
  assert.equal(await freshShell('print -r -- "${MISE_DATA_DIR-unset}"'), 'unset');
  assert.ok(!(await freshShell('print -r -- "$PATH"')).includes(root));
  passed = true;
  console.log('PASS: real mise, fresh external zsh, fixture tool resolution, app default switching, shared environment directories, restart persistence and disabling');
} finally {
  if (passed) await rm(directory, { recursive: true, force: true });
  else console.error(`Preserved failed test workspace: ${directory}`);
}
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
