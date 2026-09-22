import { _electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

if (process.platform !== 'darwin') throw new Error('Run this test on macOS');
const packaged = process.argv.includes('--packaged');
const root = await mkdtemp(path.join(os.tmpdir(), 'devhaven-mac-test-'));
const env = { ...process.env, DEVHAVEN_TEST_HOME: root };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir('artifacts', { recursive: true });
let desktop;
try {
  desktop = await _electron.launch({
    ...(packaged ? { executablePath: path.resolve(`release/mac-${process.arch}/DevHaven.app/Contents/MacOS/DevHaven`) } : {}),
    args: [`--user-data-dir=${path.join(root, 'ui')}`, ...(packaged ? [] : ['.'])], env,
  });
  const page = await desktop.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.getByRole('heading', { name: '环境', exact: true }).waitFor();
  assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), packaged);
  const snapshot = await page.evaluate(() => window.devhaven.snapshot());
  assert.equal(snapshot.platform, 'darwin');
  assert.equal(snapshot.arch, process.arch);
  assert.equal(snapshot.root, packaged ? path.join(os.homedir(), '.devhaven') : root);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('heading', { name: '全局终端环境', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.devhaven.shellStatus())).supported, true);
  assert.ok(await page.evaluate(async () => (await document.fonts.load('14px "Noto Sans SC Variable"', '环境中文')).length));

  // Exercise the packaged native addon independently, so helper permission failures are explicit.
  const session = await page.evaluate(() => window.devhaven.terminal());
  await page.evaluate(id => window.devhaven.terminalClose(id), session.id);
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await page.getByRole('heading', { name: '终端', exact: true }).waitFor();
  await page.getByRole('button', { name: '新建终端', exact: true }).first().click();
  const input = page.locator('.terminal-pane:visible .xterm-helper-textarea');
  await input.waitFor({ timeout: 15_000 });
  await input.pressSequentially('printf "MAC_PTY_RESULT=%s\\n" "$((37 * 19))"', { delay: 10 });
  await input.press('Enter');
  const hasResult = () => document.querySelector('.terminal-pane:not([hidden]) .xterm-rows')?.textContent.includes('MAC_PTY_RESULT=703');
  await page.waitForFunction(hasResult, null, { timeout: 15_000 });
  await page.screenshot({ path: 'artifacts/macos-terminal.png', fullPage: true });
  await page.getByRole('button', { name: '环境', exact: true }).click();
  await page.getByRole('tab', { name: '安装工具', exact: false }).click();
  assert.equal(await page.locator('.tool-card').count(), 11);
  for (const name of ['Java Logo', 'Apache Maven Logo']) {
    assert.ok(await page.getByRole('img', { name, exact: true }).evaluate(image => image.complete && image.naturalWidth > 0));
  }
  await page.screenshot({ path: 'artifacts/macos-catalog.png', fullPage: true });
  await page.getByRole('button', { name: '终端', exact: true }).click();
  await page.waitForFunction(hasResult);
  await page.locator('.terminal-tabs button[title^="关闭"]').click();
  await page.getByText('暂无终端会话', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`PASS: ${packaged ? 'packaged' : 'development'} macOS ${process.arch}, IPC isolation, Chinese font, catalog assets, native PTY execution, terminal persistence and cleanup`);
} catch (error) {
  const page = desktop?.windows()[0];
  if (page) {
    console.error('UI diagnostics:', await page.locator('body').innerText().catch(() => 'unavailable'));
    await page.screenshot({ path: 'artifacts/macos-smoke-failure.png', fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  await desktop?.close();
  await rm(root, { recursive: true, force: true });
}
