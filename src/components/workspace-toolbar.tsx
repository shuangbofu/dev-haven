import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Input } from './ui/input';

export function WorkspaceToolbar({ title, count, leading, context, search, filters, actions }: { title: string; count?: number; leading?: ReactNode; context?: ReactNode; search?: ReactNode; filters?: ReactNode; actions?: ReactNode }) {
  return <header className="workspace-toolbar" aria-label={`${title}工具栏`}>
    <div className="workspace-toolbar-identity">{leading}<h1>{title}</h1>{count !== undefined && <span className="workspace-title-count" aria-label={`${count} 项`}>{count}</span>}{context}</div>
    {(search || filters || actions) && <div className="workspace-toolbar-controls">
      {(search || filters) && <div className="workspace-toolbar-filters">{search}{filters}</div>}
      {actions && <div className="workspace-toolbar-actions">{actions}</div>}
    </div>}
  </header>;
}

export function ToolbarSearch({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <label className="toolbar-search"><Search size={15} aria-hidden="true" /><Input type="search" aria-label={label} placeholder={label} value={value} onChange={event => onChange(event.target.value)} /></label>;
}
