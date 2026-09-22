import { z } from 'zod';

export const iconName = (name: string) => name.normalize('NFKC').trim().toLowerCase();
export const iconSourceSchema = z.string().url().max(2000).refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }, '图标来源必须是 HTTPS 地址');
export const iconDetailsSchema = z.object({ name: z.string().trim().min(1).max(40), aliases: z.array(z.string().trim().min(1).max(40)).max(20), sourceUrl: iconSourceSchema }).strict();
export const iconImportSchema = iconDetailsSchema.extend({ type: z.literal('icon'), version: z.literal(1), id: z.string().uuid(), data: z.string().min(1).max(700_000) }).strict();
export const iconSearchSchema = z.object({ icons: z.array(iconDetailsSchema).max(20) }).strict();
export type IconImport = z.infer<typeof iconImportSchema>;
export interface LocalIcon { name: string; aliases: string[]; sourceUrl: string; dataUrl: string }
export function findIcon(icons: LocalIcon[], name: string) { const key = iconName(name); return icons.find(icon => [icon.name, ...icon.aliases].some(value => iconName(value) === key)); }
