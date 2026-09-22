export interface AgentEventSection {
  label: string;
  format: 'markdown' | 'code' | 'data';
  content: string;
}
export interface AgentEvent {
  id: string;
  kind: 'message' | 'reasoning' | 'call' | 'status';
  title: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'info';
  detail: string;
  sections?: AgentEventSection[];
  summary?: string;
  startedAt: string;
  updatedAt: string;
}

export function mergeAgentEvent(events: AgentEvent[], event: AgentEvent): void {
  const previous = events.find(item => item.id === event.id);
  if (previous) Object.assign(previous, event, { startedAt: previous.startedAt });
  else events.push(event);
}
