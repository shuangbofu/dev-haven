'use client';

import { useResolvedTheme } from './theme';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Code, Copy, ListTree, Maximize, Minimize, Minus, Plus, RotateCcw } from 'lucide-react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { toText } from 'hast-util-to-text';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { markdownHeadings, remarkHeadingIds } from '@/lib/markdown';

type ReaderProps = { content: string; title: string; onLink: (href: string) => void; actions?: ReactNode };
let diagramSequence = 0;
const markdownComponents: Components = {
  img: ({ alt }) => <span className="image-placeholder">[图片：{alt || '未命名'}]</span>,
  pre: ({ node, children }) => {
    const code = node?.children.find(child => child.type === 'element' && child.tagName === 'code');
    if (!code || code.type !== 'element') return <pre>{children}</pre>;
    const language = String(code.properties.className ?? '').match(/language-([^\s,]+)/)?.[1] ?? '';
    const source = toText(code, { whitespace: 'pre' });
    return language.toLowerCase() === 'mermaid' ? <MermaidBlock source={source} /> : <div className="reader-code"><div className="reader-code-toolbar"><span>{language || 'text'}</span><CopyButton text={source} /></div><pre>{children}</pre></div>;
  },
};

export function MarkdownReader(props: ReaderProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [outline, setOutline] = useState(false);
  const scroll = useRef(0);
  const container = useRef<HTMLDivElement>(null);
  const surface = (expanded: boolean) => <ReaderSurface {...props} scroll={scroll} outline={outline} onOutline={setOutline} fullscreen={expanded} onFullscreen={() => setFullscreen(!expanded)} />;
  return <div className="markdown-reader-host" ref={container}>
    {!fullscreen && surface(false)}
    <Dialog.Root open={fullscreen} onOpenChange={setFullscreen}>
      <Dialog.Portal><Dialog.Overlay className="reader-overlay" /><Dialog.Content className="reader-fullscreen" aria-describedby={undefined} onEscapeKeyDown={event => { if (outline) { event.preventDefault(); setOutline(false); } }} onCloseAutoFocus={event => {
        event.preventDefault();
        requestAnimationFrame(() => container.current?.querySelector<HTMLButtonElement>('[data-expand-reader]')?.focus());
      }}><Dialog.Title className="sr-only">{props.title}</Dialog.Title>{surface(true)}</Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </div>;
}

function ReaderSurface({ content, title, onLink, actions, scroll, outline, onOutline, fullscreen, onFullscreen }: ReaderProps & {
  scroll: RefObject<number>; outline: boolean; onOutline: (value: boolean) => void; fullscreen: boolean; onFullscreen: () => void;
}) {
  const headings = useMemo(() => markdownHeadings(content), [content]);
  const viewport = useRef<HTMLDivElement>(null);
  const outlineArea = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(headings[0]?.id);
  const outlineId = useId();
  useLayoutEffect(() => { const element = viewport.current; if (element) element.scrollTop = scroll.current * (element.scrollHeight - element.clientHeight); }, [scroll]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => {
      const top = element.getBoundingClientRect().top + 32;
      const nodes = [...element.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')];
      setCurrent(nodes.filter(node => node.getBoundingClientRect().top <= top).at(-1)?.id ?? nodes[0]?.id);
    };
    // Diagrams change the content height after their lazy render completes.
    const observer = new ResizeObserver(() => {
      element.scrollTop = scroll.current * Math.max(0, element.scrollHeight - element.clientHeight);
      update();
    });
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener('scroll', update, { passive: true });
    update();
    return () => { observer.disconnect(); element.removeEventListener('scroll', update); };
  }, [content, scroll]);
  useEffect(() => {
    if (!outline) return;
    const close = (event: PointerEvent) => { if (!outlineArea.current?.contains(event.target as Node)) onOutline(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [outline, onOutline]);
  const jump = useCallback((id: string) => {
    const element = viewport.current;
    const heading = [...(element?.querySelectorAll<HTMLElement>('[id]') ?? [])].find(node => node.id === id);
    if (!element || !heading) return;
    element.scrollTop += heading.getBoundingClientRect().top - element.getBoundingClientRect().top - 16;
    heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true });
    setCurrent(id); onOutline(false);
  }, [onOutline]);
  const renderedContent = useMemo(() => <article className="markdown-body"><Markdown remarkPlugins={[remarkGfm, remarkHeadingIds]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} skipHtml components={{
        ...markdownComponents,
        a: ({ href, children }) => <a href={href} onClick={event => {
          event.preventDefault();
          if (!href) return;
          if (href.startsWith('#')) { try { jump(`md-${decodeURIComponent(href.slice(1))}`); } catch { toast.error('章节链接无效'); } }
          else onLink(href);
        }}>{children}</a>,
      }}>{content}</Markdown></article>, [content, onLink, jump]);
  return <section className="markdown-reader">
    <div className="reader-toolbar">
      <strong title={title}>{title}</strong>
      {actions}
      <div className="reader-outline-control" ref={outlineArea} onKeyDown={event => { if (event.key === 'Escape' && outline) { event.stopPropagation(); onOutline(false); outlineArea.current?.querySelector('button')?.focus(); } }}>
        <Button size="icon" variant="ghost" title="文档目录" aria-label="文档目录" aria-expanded={outline} aria-controls={outlineId} disabled={!headings.length} onClick={() => onOutline(!outline)}><ListTree /></Button>
        {outline && <nav id={outlineId} className="reader-outline" aria-label="文档目录">{headings.map(heading => <button key={heading.id} aria-current={heading.id === current ? 'location' : undefined} style={{ paddingInlineStart: 12 + (heading.depth - 1) * 12 }} onClick={() => jump(heading.id)}>{heading.text}</button>)}</nav>}
      </div>
      <Button size="icon" variant="ghost" data-expand-reader title={fullscreen ? '退出全屏阅读' : '全屏阅读'} aria-label={fullscreen ? '退出全屏阅读' : '全屏阅读'} onClick={onFullscreen}>{fullscreen ? <Minimize /> : <Maximize />}</Button>
    </div>
    <div className="reader-scroll" ref={viewport} onScroll={event => { const element = event.currentTarget; scroll.current = element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight); }}>
      {renderedContent}
    </div>
  </section>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(timer); }, [copied]);
  return <Button size="icon" variant="ghost" title={copied ? '已复制' : '复制代码'} aria-label={copied ? '已复制' : '复制代码'} onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => toast.error('复制失败'))}>{copied ? <Check /> : <Copy />}</Button>;
}

function MermaidBlock({ source }: { source: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [showSource, setShowSource] = useState(false);
  const [zoom, setZoom] = useState(1);
  const dark = useResolvedTheme();
  useEffect(() => {
    let cancelled = false;
    setSvg(''); setError('');
    void import('mermaid').then(async ({ default: mermaid }) => {
      if (cancelled) return;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', suppressErrorRendering: true, maxTextSize: 100_000, flowchart: { htmlLabels: false } });
      const host = document.createElement('div');
      host.className = 'mermaid-measure'; document.body.append(host);
      try {
        const result = await mermaid.render(`mermaid-${id}-${++diagramSequence}`, source, host);
        if (!cancelled) setSvg(result.svg);
      } finally { host.remove(); }
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [source, dark, id]);
  return <div className="reader-diagram">
    <div className="reader-code-toolbar"><span>Mermaid</span>
      <Button size="icon" variant="ghost" title="缩小图表" aria-label="缩小图表" disabled={zoom <= .5 || !svg} onClick={() => setZoom(value => Math.max(.5, value - .25))}><Minus /></Button>
      <Button size="icon" variant="ghost" title="重置图表缩放" aria-label="重置图表缩放" disabled={!svg} onClick={() => setZoom(1)}><RotateCcw /></Button>
      <Button size="icon" variant="ghost" title="放大图表" aria-label="放大图表" disabled={zoom >= 3 || !svg} onClick={() => setZoom(value => Math.min(3, value + .25))}><Plus /></Button>
      <Button size="icon" variant="ghost" title="图表源码" aria-label="图表源码" aria-pressed={showSource} onClick={() => setShowSource(!showSource)}><Code /></Button><CopyButton text={source} />
    </div>
    {error && <p role="alert" className="reader-diagram-error">图表无法渲染：{error}</p>}
    {showSource || error ? <pre><code>{source}</code></pre> : svg ? <div className="reader-diagram-scroll"><div className="reader-diagram-canvas" role="img" aria-label="Mermaid 图表" style={{ width: `${zoom * 100}%` }} onClickCapture={event => { if ((event.target as Element).closest('a')) event.preventDefault(); }} dangerouslySetInnerHTML={{ __html: svg }} /></div> : <p role="status" className="reader-diagram-loading">正在渲染图表…</p>}
  </div>;
}
