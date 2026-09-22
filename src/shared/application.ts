import { searchShortcutSchema, defaultSearchShortcut } from './shortcut';
import { z } from 'zod';
export const preferencesSchema = z.object({
  searchShortcut: searchShortcutSchema.default(defaultSearchShortcut),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  accent: z.enum(['blue', 'violet', 'teal', 'amber', 'rose', 'neutral']).default('blue'),
  updates: z.object({ automatic: z.boolean().default(true) }).default({ automatic: true }),
}).strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export interface ReleaseCheck { status: 'unconfigured' | 'checking' | 'current' | 'available' | 'error'; checkedAt?: string; version?: string; url?: string; notes?: string; error?: string }
export interface ReleaseSource { provider: 'github' | 'gitlab'; repository: string }
export interface ApplicationState { version: string; updatesSupported: boolean; preferences: Preferences; release: ReleaseCheck }
