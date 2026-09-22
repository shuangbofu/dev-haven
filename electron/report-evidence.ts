import { z } from 'zod';
import { reportResultSchema } from '../src/shared/memory';

export function reportOutputSchema(ids: string[]): Record<string, unknown> {
  if (!ids.length) throw new Error('生成报告需要至少一条可引用记录');
  const schema = z.toJSONSchema(reportResultSchema) as Record<string, any>;
  schema.properties.items.items.properties.details.items.properties.evidenceIds.items = { type: 'string', enum: [...new Set(ids)] };
  return schema;
}

export function validateReportEvidence(output: z.infer<typeof reportResultSchema>, ids: string[]): string[] {
  const allowed = new Set(ids), used = new Set<string>();
  for (const [topicIndex, topic] of output.items.entries()) {
    for (const [detailIndex, detail] of topic.details.entries()) {
      if (detail.evidenceIds.some(id => !allowed.has(id))) throw new Error(`报告第 ${topicIndex + 1} 项第 ${detailIndex + 1} 条明细引用无效：引用必须来自本次报告的变更记录，请重新生成`);
      for (const id of detail.evidenceIds) used.add(id);
    }
  }
  return [...used];
}
