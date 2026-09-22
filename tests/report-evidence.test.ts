import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportOutputSchema, validateReportEvidence } from '../electron/report-evidence';

test('report output constrains each citation to the current input snapshot', () => {
  const schema = reportOutputSchema(['first-event', 'second-event', 'first-event']) as any;
  assert.deepEqual(schema.properties.items.items.properties.details.items.properties.evidenceIds.items, { type: 'string', enum: ['first-event', 'second-event'] });
  assert.throws(() => reportOutputSchema([]));
});

test('invalid references identify the detail and never silently guess a replacement', () => {
  const report = { items: [{ summary: '项目更新', details: [{ text: '完成修复', evidenceIds: ['first-event'] }, { text: '改进导航', evidenceIds: ['invented-event'] }] }] };
  assert.throws(() => validateReportEvidence(report, ['first-event']), /第 1 项第 2 条明细引用无效/);
  report.items[0].details[1].evidenceIds = ['first-event'];
  assert.deepEqual(validateReportEvidence(report, ['first-event']), ['first-event']);
});
