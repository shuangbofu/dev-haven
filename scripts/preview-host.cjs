const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1440, height: 1100, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  window.loadURL(process.env.DEVHAVEN_PREVIEW_URL || 'http://127.0.0.1:3017');
});
app.on('window-all-closed', () => app.quit());
