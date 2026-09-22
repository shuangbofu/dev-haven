import { z } from 'zod';
import { catalog, type ToolId, toolById } from './catalog';
import type { ImportPlan, Installation } from './types';

export const toolIdSchema = z.enum(catalog.map(t => t.id) as [ToolId, ...ToolId[]]);
// Exact versions only. No aliases, paths, shell syntax or backend overrides.
export const versionSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/).refine(v => /\d/.test(v) && !['latest', 'stable', 'lts', 'system'].includes(v), '请选择明确版本');
export const manifestSchema = z.object({
  format: z.literal('devhaven'), schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(80), exportedAt: z.iso.datetime(),
  source: z.object({ platform: z.string().max(24), arch: z.string().max(24) }).strict(),
  tools: z.array(z.object({ id: toolIdSchema, version: versionSchema, default: z.boolean() }).strict()).max(100),
}).strict().superRefine((manifest, ctx) => {
  const versions = new Set<string>();
  const defaults = new Set<string>();
  for (const item of manifest.tools) {
    const key = `${item.id}@${item.version}`;
    if (versions.has(key)) ctx.addIssue({ code: 'custom', message: `重复版本：${key}` });
    if (item.default && defaults.has(item.id)) ctx.addIssue({ code: 'custom', message: `${item.id} 只能有一个默认版本` });
    versions.add(key); if (item.default) defaults.add(item.id);
  }
});
export function planImport(raw: unknown, installed: Installation[], platform: string): ImportPlan {
  const manifest = manifestSchema.parse(raw);
  const warnings: string[] = [];
  if (manifest.source.platform !== platform) warnings.push('跨系统迁移：将下载适合本机的平台文件，版本可用性以安装结果为准。');
  const order = new Map(catalog.map((t, i) => [t.id, i]));
  const items = [...manifest.tools].sort((a, b) => order.get(a.id)! - order.get(b.id)!).map(item => ({
    tool: item.id, version: item.version, setDefault: item.default,
    action: installed.some(i => i.tool === item.id && i.version === item.version) ? 'installed' as const : 'install' as const,
  }));
  for (const item of items) {
    const tool = toolById(item.tool);
    if ('requires' in tool && !manifest.tools.some(t => t.id === tool.requires && t.default) && !installed.some(t => t.tool === tool.requires && t.isDefault)) {
      throw new Error(`${tool.name} 需要默认 ${toolById(tool.requires).name}，请在清单中加入该环境或先在本机安装。`);
    }
  }
  return { manifest, items, warnings };
}
