import hljs from 'highlight.js/lib/common';
import dart from 'highlight.js/lib/languages/dart';
import less from 'highlight.js/lib/languages/less';
import scss from 'highlight.js/lib/languages/scss';
hljs.registerLanguage('dart', dart);
hljs.registerLanguage('less', less);
hljs.registerLanguage('scss', scss);

// Large files remain readable without blocking the renderer with tokenization.
export function highlightSource(content: string, language?: string): string | undefined {
  if (!language || content.length > 100_000 || !hljs.getLanguage(language)) return undefined;
  try { return hljs.highlight(content, { language, ignoreIllegals: true }).value; }
  catch { return undefined; }
}
