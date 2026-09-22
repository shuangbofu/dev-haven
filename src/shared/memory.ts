import { z } from 'zod';
import { libraryKindSchema, metadataSchema, type RegistrationMethod } from './library';
import { pageSchema } from './pagination';
import type { LocalIcon } from './technology-icons';

export const eventQuerySchema = pageSchema.extend({ sourceId: z.string().uuid().optional(), path: z.string().max(4096).optional(), query: z.string().max(500).default(''), kind: libraryKindSchema.optional(), origin: z.enum(['app', 'agent', 'scan', 'git']).optional() }).strict();
export type EventQuery = z.input<typeof eventQuerySchema>;

export const relativePathSchema = z.string().max(4096).refine(value => !value.includes('\\') && !value.includes(':') && !value.includes('\0') && !value.startsWith('/') && !value.split('/').some(part => part === '..' || part.startsWith('.')), '需要来源内的相对路径');
export const sourceSchema = z.object({ id: z.string().uuid(), kind: libraryKindSchema, name: z.string().trim().min(1).max(120), directory: z.string().min(1).max(4096), scan: z.boolean(), excludes: z.array(relativePathSchema).max(100) }).strict();
export const memoryConfigSchema = z.object({
  version: z.literal(1), initialized: z.boolean(), directory: z.string().min(1).max(4096), reportsDirectory: z.string().min(1).max(4096),
  sources: z.array(sourceSchema).max(50), agent: z.object({ executable: z.string().trim().min(1).max(4096), model: z.string().max(100) }).strict(),
  autoScan: z.boolean(), scanIntervalMinutes: z.number().int().min(5).max(1440),
  gitAuthorEmails: z.array(z.string().trim().email().max(254)).max(20).default([]),
}).strict();
export type MemorySource = z.infer<typeof sourceSchema>;
export type MemoryConfig = z.infer<typeof memoryConfigSchema>;
export interface MemoryEntity { id: string; sourceId: string; path: string; metadata: z.infer<typeof metadataSchema>; updatedAt: string; revision: string; registration?: RegistrationMethod; metadataEvidence?: string[] }
export interface MemoryEvent { id: string; sourceId: string; path: string; occurredAt?: string; recordedAt: string; message: string; origin?: 'git' | 'app' | 'agent' | 'scan'; reportable: boolean; evidence: string[]; git?: { hash: string; author: string; email: string } }
export interface MemoryEventContext { kind?: MemorySource['kind']; sourceName: string; name: string; entityPath: string; target: string }
export function eventContext(event: MemoryEvent, sources: MemorySource[], entities: MemoryEntity[]): MemoryEventContext {
  const source = sources.find(item => item.id === event.sourceId);
  const entity = entities.filter(item => item.sourceId === event.sourceId && (item.path === event.path || !item.path || event.path.startsWith(`${item.path}/`))).sort((a, b) => b.path.length - a.path.length)[0];
  const entityPath = entity?.path ?? '';
  return { kind: source?.kind, sourceName: source?.name ?? '', name: entity?.metadata.name ?? source?.name ?? event.path, entityPath, target: event.path === entityPath ? '' : event.path.slice(entityPath ? entityPath.length + 1 : 0) };
}
export const reportPeriodSchema = z.enum(['daily', 'weekly', 'monthly']);
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;
export const reportNames: Record<ReportPeriod, string> = { daily: '日报', weekly: '周报', monthly: '月报' };
export function reportRange(date: string, period: ReportPeriod = 'daily') {
  reportPeriodSchema.parse(period);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('日期格式无效');
  const start = new Date(`${date}T00:00:00Z`), end = new Date(start);
  if (period === 'weekly') { start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7); end.setTime(start.getTime()); end.setUTCDate(end.getUTCDate() + 6); }
  if (period === 'monthly') { start.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + 1, 0); }
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
export interface MemoryTask { id: string; kind: 'scan' | 'report'; sourceId?: string; date?: string; period?: ReportPeriod; status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled'; createdAt: string; finishedAt?: string; logs: string[]; events?: import('./agent-event').AgentEvent[]; eventsOmitted?: number; error?: string }
export interface PersonalReport { id: string; date: string; period?: ReportPeriod; endDate?: string; createdAt: string; content: string; evidenceIds: string[]; file: string; revision: string }
export interface MemorySnapshot { config: MemoryConfig; entities: MemoryEntity[]; events: MemoryEvent[]; tasks: MemoryTask[]; reports: PersonalReport[]; warnings: string[]; skillDirectory: string; clientFile: string; iconsDirectory: string; icons: LocalIcon[] }
export const recordSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), sourceId: z.string().uuid(), path: relativePathSchema,
  occurredAt: z.string().datetime({ offset: true }), message: z.string().trim().min(1).max(4000),
  evidence: z.array(relativePathSchema).max(30), metadata: metadataSchema.optional(), metadataOnly: z.boolean().optional(),
}).strict().refine(value => !value.metadataOnly || !!value.metadata, '仅更新元数据时必须提供 metadata');
export type MemoryRecord = z.infer<typeof recordSchema>;
export const scanResultSchema = z.object({ entities: z.array(z.object({ path: relativePathSchema, kind: z.enum(['project', 'collection']), name: z.string().min(1).max(120), description: z.string().max(2000), languages: z.array(z.string().max(40)).max(20), tags: z.array(z.string().max(40)).max(20), evidence: z.array(relativePathSchema).min(1).max(10) }).strict()).max(500), changes: z.array(z.object({ path: relativePathSchema, message: z.string().min(1).max(4000), evidence: z.array(relativePathSchema).max(30) }).strict()).max(500) }).strict();
export const reportResultSchema = z.object({ items: z.array(z.object({ summary: z.string().trim().min(1).max(300), details: z.array(z.object({ text: z.string().trim().min(1).max(3000), evidenceIds: z.array(z.string()).min(1).max(50) }).strict()).min(1).max(100) }).strict()).min(1).max(30) }).strict();
export function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
