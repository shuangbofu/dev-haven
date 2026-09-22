import { z } from 'zod';

export const searchQuerySchema = z.object({ query: z.string().trim().max(300), kind: z.enum(['all', 'document', 'project']).default('all'), page: z.number().int().min(1).max(10000).default(1) }).strict();
export type SearchQuery = z.input<typeof searchQuerySchema>;
export interface SearchHit {
  id: string; kind: 'document' | 'project'; sourceId: string; sourceName: string;
  path: string; title: string; snippet: string; matchedIn: string;
  projectPath?: string; languages: string[];
}
export interface SearchResults { items: SearchHit[]; total: number; page: number; pageSize: number; partial: boolean; warnings: string[]; indexedAt?: string; indexing?: boolean }
export interface ProjectSearchTarget { id: string; sourceId: string; path: string }

export interface SearchIndexStatus { indexedAt?: string; indexing: boolean; documents: number; partial: boolean; error?: string }
