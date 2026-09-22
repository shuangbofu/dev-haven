import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron } from 'playwright';

const directory = await mkdtemp(path.join(os.tmpdir(), 'devhaven-window-test-'));
const userData = path.join(directory, 'ui');
const executablePath = process.env.DEVHAVEN_TEST_APP;
const env = { ...process.env, DEVHAVEN_TEST_HOME: path.join(directory, 'managed') };
delete env.ELECTRON_RUN_AS_NODE;
let desktop;
const launch = async () => {
  desktop = await _electron.launch({ ...(executablePath ? { executablePath } : {}), args: [`--user-data-dir=${userData}`, ...(executablePath ? [] : ['.'])], env });
  const page = await desktop.firstWindow();
  await page.getByRole('heading', { name: '环境', exact: true }).waitFor();
  return page;
};
try {
  await launch();
  const expected = await desktop.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setBounds({ x: 60, y: 70, width: 980, height: 720 });
    return window.getBounds();
  });
  // Exercise debounced writes before close, then verify persistence across processes.
  await (await desktop.firstWindow()).waitForTimeout(400);
  assert.deepEqual(JSON.parse(await readFile(path.join(userData, 'window-state.json'), 'utf8')).bounds, expected);
  await desktop.close(); desktop = undefined;
  await launch();
  assert.deepEqual(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()), expected);
  if (process.platform === 'darwin') {
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await desktop.evaluate(({ app }) => app.emit('activate'));
    await desktop.firstWindow();
    assert.deepEqual(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()), expected);
  }
  console.log('PASS: window resize persistence, process restart, and window recreation');
} finally {
  await desktop?.close();
  await rm(directory, { recursive: true, force: true });
}
