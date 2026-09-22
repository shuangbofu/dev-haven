import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, Snapshot, TerminalEvent } from '../src/shared/types';
import type { MemorySnapshot } from '../src/shared/memory';
const api: DesktopAPI = {
  application: () => ipcRenderer.invoke('devhaven:application'),
  savePreferences: preferences => ipcRenderer.invoke('devhaven:application-save', preferences),
  checkUpdates: () => ipcRenderer.invoke('devhaven:update-check'),
  onApplicationChange: callback => { const handler = (_event: Electron.IpcRendererEvent, state: import('../src/shared/application').ApplicationState) => callback(state); ipcRenderer.on('devhaven:application-change', handler); return () => ipcRenderer.removeListener('devhaven:application-change', handler); },
  searchStatus: () => ipcRenderer.invoke('devhaven:search-status'),
  rebuildSearch: () => ipcRenderer.invoke('devhaven:search-rebuild'),
  search: query => ipcRenderer.invoke('devhaven:search', query),
  cancelSearch: () => ipcRenderer.invoke('devhaven:search-cancel'),
  memorySnapshot: () => ipcRenderer.invoke('devhaven:memory-snapshot'),
  memoryEvents: query => ipcRenderer.invoke('devhaven:memory-events', query),
  memorySaveConfig: config => ipcRenderer.invoke('devhaven:memory-config', config),
  memoryChoosePath: purpose => ipcRenderer.invoke('devhaven:memory-choose', purpose),
  memoryScan: sourceId => ipcRenderer.invoke('devhaven:memory-scan', sourceId),
  memoryCancel: id => ipcRenderer.invoke('devhaven:memory-cancel', id),
  memoryReport: (date, period = 'daily') => ipcRenderer.invoke('devhaven:memory-report', { date, period }),
  memorySaveReport: (id, content, revision) => ipcRenderer.invoke('devhaven:memory-save-report', { id, content, revision }),
  memoryReveal: target => ipcRenderer.invoke('devhaven:memory-reveal', target),
  onMemoryChange: callback => { const handler = (_event: Electron.IpcRendererEvent, snapshot: MemorySnapshot) => callback(snapshot); ipcRenderer.on('devhaven:memory-change', handler); return () => ipcRenderer.removeListener('devhaven:memory-change', handler); },
  libraryCall: (sourceId, operation, input) => ipcRenderer.invoke('devhaven:library-call', { sourceId, operation, input }),
  openLink: url => ipcRenderer.invoke('devhaven:open-link', url),
  shellStatus: () => ipcRenderer.invoke('devhaven:shell-status'),
  setShellEnabled: enabled => ipcRenderer.invoke('devhaven:shell-enabled', enabled),
  snapshot: () => ipcRenderer.invoke('devhaven:snapshot'),
  bootstrap: () => ipcRenderer.invoke('devhaven:bootstrap'),
  scan: () => ipcRenderer.invoke('devhaven:scan'),
  versions: tool => ipcRenderer.invoke('devhaven:versions', tool),
  install: (tool, version) => ipcRenderer.invoke('devhaven:install', { tool, version }),
  uninstall: id => ipcRenderer.invoke('devhaven:uninstall', id),
  setDefault: id => ipcRenderer.invoke('devhaven:default', id),
  terminal: (id, repl) => ipcRenderer.invoke('devhaven:terminal', { id, repl }),
  terminalAttach: id => ipcRenderer.invoke('devhaven:terminal-attach', id),
  terminalWrite: (id, data) => ipcRenderer.invoke('devhaven:terminal-write', { id, data }),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke('devhaven:terminal-resize', { id, cols, rows }),
  terminalClose: id => ipcRenderer.invoke('devhaven:terminal-close', id),
  onTerminalEvent: callback => {
    const handler = (_event: Electron.IpcRendererEvent, event: TerminalEvent) => callback(event);
    ipcRenderer.on('devhaven:terminal-event', handler);
    return () => ipcRenderer.removeListener('devhaven:terminal-event', handler);
  },
  reveal: path => ipcRenderer.invoke('devhaven:reveal', path),
  exportManifest: name => ipcRenderer.invoke('devhaven:export', name),
  previewImport: () => ipcRenderer.invoke('devhaven:preview-import'),
  applyImport: manifest => ipcRenderer.invoke('devhaven:apply-import', manifest),
  onChange: callback => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) => callback(snapshot);
    ipcRenderer.on('devhaven:change', handler);
    return () => ipcRenderer.removeListener('devhaven:change', handler);
  },
};
contextBridge.exposeInMainWorld('devhaven', api);
