import { z } from 'zod';

export type LibraryKind = 'knowledge' | 'projects';
export const libraryKindSchema = z.enum(['knowledge', 'projects']);
export const gitRemoteSchema = z.string().trim().min(1).max(2000).refine(value => {
  if (/[\s\x00-\x1f]/.test(value)) return false;
  if (/^[\w.-]+@[\w.-]+:[^/].+$/.test(value)) return true;
  try { const url = new URL(value); return ['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) && !!url.hostname && !url.password && !url.search && !url.hash && (url.protocol === 'ssh:' || !url.username); } catch { return false; }
}, '请使用不含密码或令牌的 HTTP(S)、SSH 或 Git 仓库地址');
export const metadataSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(['collection', 'project']),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(''),
  languages: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  git: z.object({ remote: gitRemoteSchema, provider: z.enum(['github', 'gitlab', 'enterprise', 'other']).optional() }).strict().optional(),
  // Declarative only: reading metadata never executes commands.
  launch: z.object({
    command: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.+-]*$/).max(100),
    args: z.array(z.string().max(1000)).max(50),
    cwd: z.string().max(500).regex(/^(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!\/)[^\\:\x00]*$/).optional(),
    previewUrl: z.string().url().regex(/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/).optional(),
  }).strict().optional(),
}).strict();
export type LibraryMetadata = z.infer<typeof metadataSchema>;
export interface LibrarySettings { knowledge?: string; projects?: string }
export interface LibraryDestination { root: string; path: string; absolutePath: string }
export interface DestinationListing { current: LibraryDestination; folders: { name: string; path: string }[] }
export interface SelectedDestination extends LibraryDestination { sourceId: string; sourceDirectory: string }
export interface ChangeLogEntry { date?: string; message: string }
export interface GitCommit { hash: string; date: string; author: string; message: string }
export type RegistrationMethod = 'manual' | 'git' | 'agent' | 'scan';
export const registrationNames: Partial<Record<RegistrationMethod, string>> = { manual: '手动录入', git: 'Git 导入', agent: 'Agent 录入', scan: '扫描发现' };
export interface LibraryGitInfo { remote: string; provider?: 'github' | 'gitlab' | 'enterprise' | 'other'; branch?: string; commit?: string; commitMessage?: string; commitDate?: string; dirty: boolean; webUrl?: string; warning?: string }
export interface LibraryEntry {
  path: string; name: string; displayName: string; directory: boolean; description: string;
  documentTitle?: string; documentSummary?: string;
  changelog: ChangeLogEntry[];
  git?: LibraryGitInfo;
  modified: string; size: number; languages: string[]; tags: string[]; metadata?: LibraryMetadata;
  metadataRevision: string; warning?: string;
  registration?: RegistrationMethod;
}
export interface DirectoryListing { root: string; path: string; current: LibraryEntry; entries: LibraryEntry[]; warnings: string[] }
export interface ProjectListing { root: string; entries: LibraryEntry[]; groups: LibraryEntry[]; warnings: string[] }
export interface LibraryOverview { root: string; collections: LibraryEntry[]; documents: LibraryEntry[]; recent: LibraryEntry[]; tags: string[]; warnings: string[] }
export interface LibraryDocument { path: string; content: string; revision: string; format: 'markdown' | 'html' | 'code' | 'text' | 'unsupported'; language?: string; size: number }
export interface MetadataWrite { kind: LibraryKind; path: string; metadata: LibraryMetadata; revision: string }
