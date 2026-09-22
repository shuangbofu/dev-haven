import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ShellIntegration } from '../electron/shell-integration';
import { WindowsEnvironmentIntegration, type WindowsEnvironmentStore, type WindowsValues } from '../electron/windows-environment';

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devhaven-shell-'));
  const userDirectory = path.join(directory, "user's home $literal");
  await mkdir(userDirectory);
  const root = path.join(userDirectory, '.devhaven');
  const shell = new ShellIntegration(root, { home: userDirectory, zdotdir: userDirectory, platform: 'darwin', shell: '/bin/zsh' });
  return { directory, userDirectory, root, shell, rc: path.join(userDirectory, '.zshrc') };
}

test('central config is backed up, enabling is idempotent and disabling preserves subsequent edits', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.userDirectory, 'config'));
    const config = path.join(f.userDirectory, 'config', 'env.sh');
    await writeFile(f.rc, 'source "$HOME/config/env.sh"\n');
    await writeFile(config, '# existing settings\nexport MY_SETTING=preserved\n');
    const enabled = await f.shell.setEnabled(true);
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.configFile, config);
    assert.equal(await readFile(enabled.backupFile!, 'utf8'), '# existing settings\nexport MY_SETTING=preserved\n');
    const configured = await readFile(config, 'utf8');
    await f.shell.setEnabled(true);
    assert.equal(await readFile(config, 'utf8'), configured);
    await appendFile(config, '# added after enabling\n');
    await f.shell.setEnabled(true);
    assert.equal(await readFile(config, 'utf8'), configured + '# added after enabling\n');
    assert.equal((await f.shell.setEnabled(false)).enabled, false);
    assert.equal(await readFile(config, 'utf8'), '# existing settings\nexport MY_SETTING=preserved\n# added after enabling\n');
    assert.equal(await readFile(f.rc, 'utf8'), 'source "$HOME/config/env.sh"\n');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('restores an original without a trailing newline and preserves a symlinked configuration', async () => {
  const f = await fixture();
  try {
    const original = path.join(f.userDirectory, 'dotfile');
    await writeFile(original, '# original without newline');
    await symlink(original, f.rc);
    await f.shell.setEnabled(true);
    assert.ok((await lstat(f.rc)).isSymbolicLink());
    await f.shell.setEnabled(false);
    assert.ok((await lstat(f.rc)).isSymbolicLink());
    assert.equal(await readFile(original, 'utf8'), '# original without newline');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('rejects conflicting mise activation and malformed blocks without modifying the configuration', async () => {
  const f = await fixture();
  try {
    for (const contents of ['eval "$(mise activate zsh)"\n', '# >>> DevHaven 全局终端环境 >>>\n']) {
      await writeFile(f.rc, contents);
      await assert.rejects(f.shell.setEnabled(true), /mise|配置标记/);
      assert.equal(await readFile(f.rc, 'utf8'), contents);
    }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('missing engine is harmless, unusual paths are quoted, and a newly created rc is removed on disable', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture();
  try {
    await f.shell.setEnabled(true);
    execFileSync('/bin/zsh', ['-n', f.shell.scriptFile]);
    assert.match(await readFile(f.shell.scriptFile, 'utf8'), /unset GOROOT GOTOOLDIR/);
    // No engine yet: sourcing the integration must not alter mise paths or fail startup.
    const result = execFileSync('/bin/zsh', ['-fc', 'source "$1"; print -r -- "${MISE_DATA_DIR-unset}"', '--', f.rc], {
      env: { PATH: '/usr/bin:/bin', ZDOTDIR: f.userDirectory, NODE_ENV: 'test' }, encoding: 'utf8',
    });
    assert.equal(result.trim(), 'unset');
    assert.equal((await f.shell.status()).enabled, true);
    await f.shell.setEnabled(false);
    await assert.rejects(readFile(f.rc), { code: 'ENOENT' });
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('unsupported shells refuse changes and custom ZDOTDIR is respected', async () => {
  const f = await fixture();
  try {
    const unsupported = new ShellIntegration(f.root, { home: f.userDirectory, platform: 'linux', shell: '/bin/csh' });
    assert.equal((await unsupported.status()).supported, false);
    await assert.rejects(unsupported.setEnabled(true), /Shell/);
    const dotdir = path.join(f.userDirectory, 'custom-zsh');
    const custom = new ShellIntegration(f.root, { home: f.userDirectory, zdotdir: dotdir, platform: 'darwin', shell: '/bin/zsh' });
    assert.equal((await custom.setEnabled(true)).configFile, path.join(dotdir, '.zshrc'));
    await assert.rejects(readFile(f.rc), { code: 'ENOENT' });
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('linux bash uses login and non-login startup files without fixed home paths', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devhaven-bash-'));
  const home = path.join(directory, 'home with spaces');
  const root = path.join(home, '.devhaven');
  try {
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, '.bash_profile'), '# profile\n');
    const shell = new ShellIntegration(root, { home, platform: 'linux', shell: '/bin/bash' });
    const enabled = await shell.setEnabled(true);
    assert.equal(enabled.configFiles.length, 2);
    assert.match(await readFile(path.join(home, '.bashrc'), 'utf8'), /DevHaven/);
    assert.match(await readFile(path.join(home, '.bash_profile'), 'utf8'), /DevHaven/);
    await shell.setEnabled(false);
    assert.equal(await readFile(path.join(home, '.bash_profile'), 'utf8'), '# profile\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('windows integration preserves unrelated PATH entries and restores owned values', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'devhaven-win-'));
  const values: WindowsValues = { Path: { value: 'C:\\Tools;D:\\Other', kind: 'ExpandString' } };
  const store: WindowsEnvironmentStore = {
    async read(names) { return Object.fromEntries(names.flatMap(name => values[name] ? [[name, values[name]]] : [])); },
    async write(changes) { for (const [key, value] of Object.entries(changes)) { if (value) values[key] = value; else delete values[key]; } },
  };
  try {
    const root = path.win32.join('C:\\Users', 'User Name', '.devhaven');
    const integration = new WindowsEnvironmentIntegration(root, store, directory);
    await integration.setEnabled(true);
    assert.ok(values.Path.value.includes('C:\\Tools'));
    assert.ok(values.Path.value.toLowerCase().includes(path.win32.join(root, 'data', 'shims').toLowerCase()));
    assert.equal(values.MISE_DATA_DIR.value, path.win32.join(root, 'data'));
    await integration.setEnabled(false);
    assert.equal(values.Path.value, 'C:\\Tools;D:\\Other');
    assert.equal(values.MISE_DATA_DIR, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
