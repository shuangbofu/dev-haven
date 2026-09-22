import { _electron } from 'playwright';
import electron from 'electron';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

if (process.platform !== 'win32') throw new Error('Run this test with Windows Node.js');
const root = await mkdtemp(path.join(os.tmpdir(), 'devhaven-win-test-'));
const packaged = process.argv.includes('--packaged');
const env = { ...process.env, DEVHAVEN_TEST_HOME: root }; delete env.ELECTRON_RUN_AS_NODE;
await mkdir('artifacts', { recursive: true });
let desktop;
try {
  desktop = await _electron.launch({ executablePath: path.resolve(packaged ? 'release/win-unpacked/DevHaven.exe' : electron), args: packaged ? ['--headless', `--user-data-dir=${path.join(root, 'ui')}`] : ['--headless', `--user-data-dir=${path.join(root, 'ui')}`, '.'], env });
  const page = await desktop.firstWindow();
  const openCatalog = async () => { await page.getByRole('button', { name: '环境', exact: true }).click(); await page.getByRole('tab', { name: '安装工具', exact: false }).click(); };
  await page.emulateMedia({ colorScheme: null });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.getByRole('heading', { name: '环境', exact: true }).waitFor({ timeout: 20_000 });
  const state = await page.evaluate(() => window.devhaven.scan());
  assert.equal(state.platform, 'win32'); assert.equal(state.root, packaged ? path.join(os.homedir(), '.devHaven') : root);
  assert.equal(await page.getByRole('button', { name: '环境迁移', exact: true }).count(), 0);
  assert.equal(await page.getByRole('navigation').getByRole('button').count(), 4);
  assert.equal(await page.getByRole('navigation').getByRole('button', { name: '工具仓库', exact: true }).count(), 0);
  assert.equal(await page.getByRole('navigation').getByRole('button', { name: '任务日志', exact: true }).count(), 0);
  await page.getByRole('tab', { name: '安装记录', exact: false }).click();
  assert.equal(await page.locator('.data-table tbody tr').count(), state.tasks.length);
  if (state.tasks.length) {
    await page.getByRole('button', { name: /^查看日志 / }).first().click();
    await page.getByRole('dialog').getByRole('heading', { name: '任务日志', exact: true }).waitFor();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await page.getByRole('tab', { name: '受管环境', exact: false }).click();
  assert.equal(await page.getByRole('button', { name: '导入清单', exact: true }).count(), 1);
  if (state.installations.length) {
    const manifestPath = path.join(root, 'environment.json');
    await desktop.evaluate(({ dialog }, file) => {
      globalThis.restoreTestDialogs = () => { dialog.showSaveDialog = save; dialog.showOpenDialog = open; };
      const save = dialog.showSaveDialog, open = dialog.showOpenDialog;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, manifestPath);
    await page.getByRole('button', { name: '导出清单', exact: true }).click();
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).tools.length, state.installations.length);
    await page.getByRole('button', { name: '导入清单', exact: true }).click();
    await page.getByRole('heading', { name: '导入环境清单', exact: true }).waitFor();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await desktop.evaluate(() => { globalThis.restoreTestDialogs(); delete globalThis.restoreTestDialogs; });
  }
  const fonts = await page.evaluate(async () => { await document.fonts.ready; const loaded = await document.fonts.load('14px "Noto Sans SC Variable"', '环境中文显示'); return loaded.length; });
  assert.ok(fonts > 0, 'Bundled Chinese font must load without an OS font dependency');
  assert.equal(await desktop.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'system');
  await desktop.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(255, 255, 255)');
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.screenshot({ path: 'artifacts/windows-native.png', fullPage: true });
  await openCatalog();
  assert.equal(await page.locator('.tool-card').count(), 11);
  for (const name of ['Java Logo', 'Apache Maven Logo']) {
    const loaded = await page.getByRole('img', { name, exact: true }).evaluate(image => image.complete && image.naturalWidth > 0);
    assert.ok(loaded, `${name} should load`);
  }
  await page.screenshot({ path: 'artifacts/windows-catalog.png', fullPage: true });
  await desktop.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(9, 9, 11)');
  assert.equal(await page.locator('.sidebar').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 24, 27)');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('button[aria-label="管理 Node.js"]')).backgroundColor === 'rgb(9, 9, 11)');
  await page.screenshot({ path: 'artifacts/windows-catalog-dark.png', fullPage: true });
  await page.getByRole('button', { name: '管理 Node.js', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(9, 9, 11)');
  await page.screenshot({ path: 'artifacts/windows-dialog-dark.png', fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await desktop.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(255, 255, 255)');
  await desktop.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'system'; });
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await page.getByRole('button', { name: '新建终端', exact: true }).first().click();
  const input = page.locator('.terminal-pane:visible .xterm-helper-textarea');
  await input.waitFor();
  await page.waitForFunction(() => /PS .*>/.test(document.querySelector('.terminal-pane:not([hidden]) .xterm-rows')?.textContent ?? ''));
  await input.pressSequentially('Write-Output (37 * 19)', { delay: 20 }); await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('.terminal-pane:not([hidden]) .xterm-rows')?.textContent.includes('703'), { timeout: 15_000 });
  await page.getByRole('button', { name: '环境', exact: true }).click();
  await page.getByRole('button', { name: '终端', exact: true }).click();
  assert.ok(await page.locator('.terminal-pane:visible .xterm-rows').textContent().then(text => text.includes('703')));
  const python = state.installations.find(item => item.tool === 'python');
  if (python) {
    await page.getByRole('button', { name: '环境', exact: true }).click();
    await page.getByRole('tab', { name: '受管环境', exact: false }).click();
    await page.getByRole('button', { name: `打开 Python ${python.version} 终端`, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.terminal-pane:not([hidden]) .xterm-rows')?.textContent.includes('>>>'));
    await input.pressSequentially('sum([19, 23])', { delay: 20 }); await input.press('Enter');
    await page.waitForFunction(() => /42/.test(document.querySelector('.terminal-pane:not([hidden]) .xterm-rows')?.textContent ?? ''));
    await input.pressSequentially('import time; time.sleep(60)', { delay: 10 }); await input.press('Enter');
    await page.getByRole('button', { name: '中断命令', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.terminal-pane:not([hidden]) .xterm-rows')?.textContent.includes('KeyboardInterrupt'));
    await page.screenshot({ path: 'artifacts/windows-python-terminal.png', fullPage: true });
    await page.getByRole('button', { name: '普通命令行', exact: true }).click();
    await page.waitForFunction(() => /PS .*>/.test(document.querySelector('.terminal-pane:not([hidden]) .xterm-rows')?.textContent ?? ''));
    await input.pressSequentially('python -c "print(12345 * 6789)"', { delay: 15 }); await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('.terminal-pane:not([hidden]) .xterm-rows')?.textContent.includes('83810205'));
    const shellPanel = await page.locator('.terminal-pane:visible').getAttribute('id');
    await input.pressSequentially('exit', { delay: 20 }); await input.press('Enter');
    await page.locator(`[id="${shellPanel}"]`).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('tab', { selected: true }).textContent(), '命令行');
    await page.getByRole('tab', { name: `Python ${python.version} · 交互`, exact: true }).click();
    const pythonPanel = await page.locator('.terminal-pane:visible').getAttribute('id');
    await input.pressSequentially('exit()', { delay: 20 }); await input.press('Enter');
    await page.locator(`[id="${pythonPanel}"]`).waitFor({ state: 'detached' });
    assert.equal(await page.locator('.terminal-tabs [role="tab"]').count(), 1);
    assert.equal(await page.getByRole('tab', { selected: true }).textContent(), '命令行');
    await assert.rejects(page.evaluate(id => window.devhaven.terminalAttach(id), pythonPanel.slice('terminal-'.length)), /会话已关闭/);
  }
  assert.equal(desktop.windows().length, 1, 'Terminal sessions must remain inside the app');
  // A process can exit while the user is on another page; the last tab must still disappear.
  await input.pressSequentially('Start-Sleep -Seconds 2; exit', { delay: 15 }); await input.press('Enter');
  await openCatalog();
  await page.locator('.terminal-tabs').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await page.getByText('暂无终端会话', { exact: true }).waitFor();
  await page.getByRole('button', { name: '新建终端', exact: true }).first().click();
  await input.waitFor();
  await page.locator('.terminal-tabs button[title^="关闭"]').click();
  await page.getByText('暂无终端会话', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`PASS: native Windows, Chinese font, ${python ? 'Python REPL exit(), Ctrl+C, selected Python shell exit, ' : ''}automatic tab closure, background exit, session cleanup/recreation, embedded PTY, catalog, live light/dark theme changes, no renderer errors`);
} catch (error) {
  const page = desktop?.windows()[0];
  if (page) {
    console.error('UI diagnostics:', await page.evaluate(() => ({ dark: matchMedia('(prefers-color-scheme: dark)').matches, background: getComputedStyle(document.body).backgroundColor, toasts: [...document.querySelectorAll('[data-sonner-toast]')].map(el => el.textContent), terminal: document.querySelector('.terminal-pane:not([hidden]) .xterm-rows')?.textContent?.slice(-4000) })).catch(() => null));
    await page.screenshot({ path: 'artifacts/windows-smoke-failure.png', fullPage: true }).catch(() => {});
  }
  throw error;
} finally { await desktop?.close(); await rm(root, { recursive: true, force: true }); }
