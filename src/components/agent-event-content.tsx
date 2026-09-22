'use client';

import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { AgentEventSection } from '@/shared/agent-event';
type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' ? value : '';
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const labels: Record<string, string> = { path: '路径', name: '名称', description: '说明', languages: '技术栈', tags: '标签', kind: '类型', message: '说明', text: '内容', command: '命令', args: '参数', cwd: '工作目录', query: '查询', url: '地址', status: '状态', completed: '已完成', tool: '工具', server: '服务', input_tokens: '输入 Token', cached_input_tokens: '缓存 Token', output_tokens: '输出 Token' };

export function AgentMarkdown({ text }: { text: string }) {
  return <div className="markdown-body agent-markdown"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>{alt || '图片'}</span> }}>{text}</Markdown></div>;
}

function ReportResult({ items }: { items: Row[] }) {
  return <div className="agent-report-result"><h3>报告内容</h3><ol className="agent-report-topics">{items.map((item, index) => <li key={index}><h4>{text(item.summary)}</h4><ul>{array(item.details).filter(record).map((detail, i) => <li key={i}><AgentMarkdown text={text(detail.text)} />{!!array(detail.evidenceIds).length && <small>{array(detail.evidenceIds).length} 条引用 · 依据见报告</small>}</li>)}</ul></li>)}</ol></div>;
}

function ScanResult({ result }: { result: Row }) {
  const entries = array(result.entities).filter(record), changes = array(result.changes).filter(record);
  const [limit, setLimit] = useState(10);
  return <div className="agent-scan-result"><h3>识别到 {entries.length} 个项目与知识集合</h3><div className="agent-scan-entries">{entries.slice(0, limit).map((entry, i) => <article key={i}>
    <header><h4>{text(entry.name)}</h4><span>{entry.kind === 'project' ? '项目' : '知识集合'}</span></header><AgentMarkdown text={text(entry.description)} />
    <div className="agent-result-tags" aria-label="技术栈与标签">{array(entry.languages).map((language, index) => <span key={index}>{text(language)}</span>)}{array(entry.tags).map((tag, index) => <span key={`tag:${index}`}>#{text(tag)}</span>)}</div>
    <div className="agent-result-location">{text(entry.path) || '来源根目录'}{array(entry.evidence).length ? ` · 已参考 ${array(entry.evidence).length} 个文件` : ''}</div>
  </article>)}</div>{entries.length > limit && <button className="agent-more" onClick={() => setLimit(limit + 10)}>再显示 10 项（剩余 {entries.length - limit} 项）</button>}
  {!!changes.length && <section><h4>发现的变化</h4><ul>{changes.slice(0, 50).map((change, i) => <li key={i}><AgentMarkdown text={text(change.message)} /><small>{text(change.path)}</small></li>)}</ul></section>}</div>;
}

function Cell({ value, onInspect }: { value: unknown; onInspect: (value: unknown) => void }) {
  if (value === null || value === undefined) return <span className="project-muted">—</span>;
  if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>;
  if (typeof value !== 'object') return <span className="agent-cell-text">{String(value)}</span>;
  if (Array.isArray(value) && value.every(item => item === null || typeof item !== 'object')) return <span className="agent-cell-text">{value.map(String).join('、') || '无'}</span>;
  return <button className="agent-inspect" onClick={() => onInspect(value)}>{Array.isArray(value) ? `${value.length} 项数据` : `${Object.keys(value).length} 个字段`} · 查看</button>;
}

function DataTable({ value }: { value: unknown }) {
  const [trail, setTrail] = useState<unknown[]>([]), [limit, setLimit] = useState(20);
  const current = trail.length ? trail[trail.length - 1] : value, rows = Array.isArray(current) ? current : undefined;
  const objects = rows?.every(record), columns = objects ? [...new Set(rows!.flatMap(row => Object.keys(row as Row)))].slice(0, 12) : [];
  const inspect = (next: unknown) => { setTrail([...trail, next]); setLimit(20); };
  return <div className="agent-data-table">{!!trail.length && <button className="agent-more" onClick={() => { setTrail(trail.slice(0, -1)); setLimit(20); }}>返回上一级数据</button>}
    <div className="agent-table-scroll"><table><thead><tr>{objects && columns.length ? columns.map(key => <th key={key}>{labels[key] ?? key}</th>) : <><th>{rows ? '序号' : '字段'}</th><th>内容</th></>}</tr></thead><tbody>
      {rows ? rows.slice(0, limit).map((row, i) => <tr key={i}>{objects && columns.length ? columns.map(key => <td key={key}><Cell value={(row as Row)[key]} onInspect={inspect} /></td>) : <><th>{i + 1}</th><td><Cell value={row} onInspect={inspect} /></td></>}</tr>) : record(current) ? Object.entries(current).slice(0, limit).map(([key, item]) => <tr key={key}><th>{labels[key] ?? key}</th><td><Cell value={item} onInspect={inspect} /></td></tr>) : <tr><td colSpan={2}><Cell value={current} onInspect={inspect} /></td></tr>}
    </tbody></table></div>{(rows?.length ?? (record(current) ? Object.keys(current).length : 0)) > limit && <button className="agent-more" onClick={() => setLimit(limit + 20)}>显示更多</button>}</div>;
}

export function AgentContent({ section }: { section: AgentEventSection }) {
  let value: unknown;
  try { value = JSON.parse(section.content); } catch { /* prose or command output */ }
  if (record(value) && Array.isArray(value.entities) && Array.isArray(value.changes)) return <ScanResult result={value} />;
  if (record(value) && Array.isArray(value.items) && value.items.every(item => record(item) && typeof item.summary === 'string' && Array.isArray(item.details))) return <ReportResult items={value.items as Row[]} />;
  if (value !== undefined && (record(value) || Array.isArray(value))) return <DataTable value={value} />;
  if (section.format === 'code') return <pre className="agent-code"><code>{section.content}</code></pre>;
  return <AgentMarkdown text={typeof value === 'string' ? value : section.content} />;
}
