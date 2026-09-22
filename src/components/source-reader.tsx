'use client';

import { useMemo } from 'react';
import { highlightSource } from '@/lib/highlight-source';

export function SourceReader({ content, language }: { content: string; language?: string }) {
  const highlighted = useMemo(() => highlightSource(content, language), [content, language]);
  return <div className="source-reader" aria-label={`${language || '纯文本'} 阅读区`}>
    <pre>{highlighted === undefined ? <code>{content}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />}</pre>
  </div>;
}
