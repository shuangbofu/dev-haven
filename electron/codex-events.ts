import { randomUUID } from 'node:crypto';
import type { AgentEvent, AgentEventSection } from '../src/shared/agent-event';
type Data = Record<string, unknown>;
const object = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const show = (value: unknown) => typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, (key, data) => key === 'data' && typeof data === 'string' && data.length > 2048 ? '[二进制内容已省略]' : data, 2);

export function redactAgentLog(text: string): string {
  return text.replace(/sk-[\w-]+/g, '[redacted]')
    .replace(/(Bearer\s+)[\w.+/=-]+/gi, '$1[redacted]')
    .replace(/((?:["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,}]+)/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
}

function sectionsFor(event: Data, item: Data): AgentEventSection[] {
  const sections: AgentEventSection[] = [];
  const add = (label: string, value: unknown, format: AgentEventSection['format'] = 'data') => {
    if (value === undefined || value === null || value === '') return;
    // Redact strings before serialization so structured content remains valid JSON.
    const clean = (input: unknown): unknown => typeof input === 'string' ? redactAgentLog(input)
      : Array.isArray(input) ? input.map(clean) : input && typeof input === 'object'
        ? Object.fromEntries(Object.entries(input).map(([key, data]) => [key, /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)$/i.test(key) ? '[redacted]' : clean(data)])) : input;
    let content = typeof value === 'string' ? value : show(value);
    if (format !== 'code') {
      try { value = typeof value === 'string' ? JSON.parse(value) : value; content = JSON.stringify(clean(value)); format = 'data'; }
      catch { content = redactAgentLog(content); format = 'markdown'; }
    } else content = redactAgentLog(content);
    if (content.length > 24000) { content = `${content.slice(0, 24000)}\n[内容过长，已截断]`; format = 'code'; }
    sections.push({ label, format, content });
  };
  switch (item.type) {
    case 'agent_message': add('消息', item.text, 'markdown'); break;
    case 'reasoning': add('过程摘要', item.text, 'markdown'); break;
    case 'command_execution': add('命令', item.command, 'code'); add('输出', item.aggregated_output, 'code'); add('退出码', item.exit_code); break;
    case 'mcp_tool_call': {
      add('调用参数', item.arguments);
      const result = object(item.result);
      if (Array.isArray(result.content)) for (const block of result.content.slice(0, 20)) {
        const data = object(block);
        if (data.type === 'text') add('执行结果', data.text, 'markdown');
        else if (data.type === 'resource_link') add('资源', { name: data.name, uri: data.uri });
        else add('返回内容', `${show(data.type)} 内容`, 'markdown');
      }
      add('结构化结果', result.structured_content); add('错误', object(item.error).message, 'markdown'); break;
    }
    case 'web_search': add('搜索内容', item.query, 'markdown'); add('搜索操作', item.action); break;
    case 'file_change': add('文件变更', item.changes); break;
    case 'todo_list': add('执行计划', item.items); break;
    case 'collab_tool_call': add('调用内容', item); break;
    case 'error': add('错误', item.message, 'markdown'); break;
  }
  add('错误', object(event.error).message, 'markdown'); add('消息', event.message, 'markdown'); add('用量', event.usage);
  return sections;
}

/** Render the public exec JSONL event fields; no private session data is read. */
export function formatCodexEvent(value: unknown): string {
  const event = object(value), item = object(event.item);
  const type = show(event.type) || 'event';
  const lines = [`${type}${item.type ? ` · ${show(item.type)}` : ''}${item.id ? ` · ${show(item.id)}` : ''}${item.status ? ` · ${show(item.status)}` : ''}`];
  const add = (label: string, detail: unknown) => { const text = show(detail); if (text) lines.push(`${label}${text}`); };
  switch (item.type) {
    case 'agent_message': case 'reasoning': add(item.type === 'reasoning' ? '过程摘要：\n' : '消息：\n', item.text); break;
    case 'command_execution':
      add('命令：', item.command); add('输出：\n', item.aggregated_output); add('退出码：', item.exit_code); break;
    case 'mcp_tool_call':
      add('工具：', `${show(item.server)} / ${show(item.tool)}`); add('参数：\n', item.arguments);
      add('结果：\n', item.result); add('错误：', item.error); break;
    case 'web_search': add('搜索：', item.query); add('操作：', item.action); break;
    case 'file_change': add('文件变更：\n', item.changes); break;
    case 'todo_list': add('计划：\n', item.items); break;
    case 'error': add('错误：', item.message); break;
    default: if (item.type) add('详情：\n', item);
  }
  add('错误：', event.error); add('消息：', event.message); add('用量：', event.usage);
  return redactAgentLog(lines.join('\n'));
}

export class CodexEvents {
  private readonly runId = randomUUID();
  private sequence = 0;
  private items = new Map<string, Data>();
  constructor(private emit: (event: AgentEvent) => void) {}
  accept(value: unknown) {
    const event = object(value), type = show(event.type);
    if (!type) return;
    let item = object(event.item);
    const itemId = show(item.id);
    if (itemId) {
      item = { ...this.items.get(itemId), ...item };
      this.items.set(itemId, item);
      if (this.items.size > 300) this.items.delete(this.items.keys().next().value!);
    }
    const itemType = show(item.type);
    const kind: AgentEvent['kind'] = itemType === 'agent_message' ? 'message' : itemType === 'reasoning' ? 'reasoning'
      : ['command_execution', 'mcp_tool_call', 'web_search', 'file_change', 'collab_tool_call'].includes(itemType) ? 'call' : 'status';
    const titles: Record<string, string> = { agent_message: 'Codex 消息', reasoning: '过程摘要', command_execution: '执行命令', mcp_tool_call: `${show(item.server)} / ${show(item.tool)}`, web_search: '搜索网页', file_change: '文件变更', collab_tool_call: '智能体调用', todo_list: '执行计划', error: '执行错误', 'thread.started': '会话开始', 'turn.started': '开始处理', 'turn.completed': '本轮完成', 'turn.failed': '本轮失败' };
    const status: AgentEvent['status'] = type === 'turn.failed' || type === 'error' || itemType === 'error' || ['failed', 'declined'].includes(show(item.status)) || typeof item.exit_code === 'number' && item.exit_code !== 0 || item.error != null ? 'failed'
      : type === 'item.completed' || type === 'turn.completed' ? 'completed'
      : type === 'item.started' || type === 'item.updated' ? 'running' : 'info';
    const detail = kind === 'message' || kind === 'reasoning' ? redactAgentLog(show(item.text)) : formatCodexEvent({ ...event, item });
    const time = new Date().toISOString();
    const sections = sectionsFor(event, item);
    const summary = itemType === 'command_execution' ? show(item.command) : itemType === 'web_search' ? show(item.query) : '';
    this.emit({ id: `${this.runId}:${itemId ? `item:${itemId}` : `event:${++this.sequence}`}`, kind, title: redactAgentLog(titles[itemType || type] ?? (itemType || type)), status, sections, summary: redactAgentLog(summary).slice(0, 200),
      detail: detail.length > 32000 ? `${detail.slice(0, 32000)}\n[内容超过 32000 字符，已截断]` : detail, startedAt: time, updatedAt: time });
    if (type === 'item.completed') this.items.delete(itemId);
  }
}
