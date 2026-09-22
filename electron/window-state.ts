import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserWindow, Rectangle } from 'electron';
import { z } from 'zod';

const schema = z.object({
  bounds: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() }),
  maximized: z.boolean(),
});
type WindowState = z.infer<typeof schema>;

export function restoreWindowState(saved: unknown, areas: Rectangle[], primary: Rectangle) {
  const parsed = schema.safeParse(saved);
  const bounds = parsed.success ? parsed.data.bounds : undefined;
  const overlap = (area: Rectangle) => bounds ? Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x))
    * Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)) : 0;
  const area = areas.reduce((best, next) => overlap(next) > overlap(best) ? next : best, primary);
  const minWidth = Math.min(940, area.width), minHeight = Math.min(680, area.height);
  const width = Math.min(area.width, Math.max(minWidth, bounds?.width ?? 1100));
  const height = Math.min(area.height, Math.max(minHeight, bounds?.height ?? 780));
  const visible = bounds && overlap(area) > 0;
  return {
    bounds: {
      x: visible ? Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)) : area.x + Math.floor((area.width - width) / 2),
      y: visible ? Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) : area.y + Math.floor((area.height - height) / 2),
      width, height,
    },
    maximized: parsed.success && parsed.data.maximized,
    minWidth, minHeight,
  };
}

export function readWindowState(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { return undefined; }
}

export function trackWindowState(window: BrowserWindow, file: string, initial: WindowState) {
  let state = initial;
  let timer: NodeJS.Timeout | undefined;
  const capture = () => {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
    state = { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
  };
  const save = () => {
    clearTimeout(timer);
    capture();
    // Flush synchronously on close so app.quit cannot interrupt the small atomic write.
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    } catch (error) { console.error('Unable to save window state:', error); }
  };
  const schedule = () => { capture(); clearTimeout(timer); timer = setTimeout(save, 250); };
  window.on('resize', schedule);
  window.on('move', schedule);
  window.on('maximize', schedule);
  window.on('unmaximize', schedule);
  window.on('leave-full-screen', schedule);
  window.on('close', save);
  window.on('closed', () => clearTimeout(timer));
}
