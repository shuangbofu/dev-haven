'use client';
import { useMemo, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Button } from './ui/button';
import { safeHTMLDocument } from '@/lib/html-document';
import { useResolvedTheme } from './theme';
export function HTMLReader({ content, title, actions }: { content: string; title: string; actions?: React.ReactNode }) {
  const [full, setFull] = useState(false);
  const dark = useResolvedTheme();
  const html = useMemo(() => safeHTMLDocument(content, dark), [content, dark]);
  return <section className={`html-reader${full ? ' html-reader-full' : ''}`}>
    <div className="document-toolbar"><strong>{title}</strong>{actions}<Button size="icon" variant="ghost" title={full ? '退出全屏阅读' : '全屏阅读'} aria-label={full ? '退出全屏阅读' : '全屏阅读'} onClick={() => setFull(value => !value)}>{full ? <Minimize2 /> : <Maximize2 />}</Button></div>
    <iframe title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={html} />
  </section>;
}
