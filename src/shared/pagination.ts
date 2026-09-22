import { z } from 'zod';

export const pageSchema = z.object({ page: z.number().int().min(1).max(1000000).default(1), pageSize: z.number().int().min(1).max(50).default(20) });
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export function paginate<T>(items: T[], input: { page?: number; pageSize?: number }): Page<T> {
  const { page: requested, pageSize } = pageSchema.parse(input);
  const page = Math.min(requested, Math.max(1, Math.ceil(items.length / pageSize)));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}
