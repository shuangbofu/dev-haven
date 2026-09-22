import { z } from 'zod';
export const searchShortcutSchema = z.object({
  code: z.string().regex(/^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2]))$/),
  modifiers: z.array(z.enum(['primary', 'alt', 'shift'])).min(1).max(3),
}).strict().refine(value => new Set(value.modifiers).size === value.modifiers.length && (value.modifiers.includes('primary') || value.modifiers.includes('alt')), '请包含 Command/Ctrl 或 Alt 修饰键')
.refine(value => !(value.modifiers.includes('primary') && ['KeyQ', 'KeyW', 'KeyC', 'KeyV', 'KeyX', 'KeyA', 'KeyZ'].includes(value.code)), '此组合用于退出、关闭或文本编辑，请使用其他快捷键');
export type SearchShortcut = z.infer<typeof searchShortcutSchema>;
export const defaultSearchShortcut: SearchShortcut = { code: 'KeyK', modifiers: ['primary'] };
export function shortcutLabel(shortcut: SearchShortcut, mac: boolean) {
  return [...(['primary', 'alt', 'shift'] as const).filter(modifier => shortcut.modifiers.includes(modifier)).map(modifier => ({ primary: mac ? '⌘' : 'Ctrl', alt: mac ? '⌥' : 'Alt', shift: mac ? '⇧' : 'Shift' })[modifier]), shortcut.code.replace(/^(Key|Digit)/, '')].join(mac ? '' : '+');
}
export function matchesShortcut(event: { code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean; repeat?: boolean }, shortcut: SearchShortcut, mac: boolean) {
  return !event.isComposing && !event.repeat && event.code === shortcut.code && (mac ? event.metaKey : event.ctrlKey) === shortcut.modifiers.includes('primary') && !(mac ? event.ctrlKey : event.metaKey) && event.altKey === shortcut.modifiers.includes('alt') && event.shiftKey === shortcut.modifiers.includes('shift');
}
