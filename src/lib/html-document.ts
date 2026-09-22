import DOMPurify from 'dompurify';
export function safeHTMLDocument(content: string, dark: boolean) {
  const body = DOMPurify.sanitize(content, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'base', 'meta', 'link', 'audio', 'video', 'source'],
    FORBID_ATTR: ['href', 'srcset', 'action', 'formaction', 'target', 'download'],
    ALLOW_DATA_ATTR: false,
  });
  // sandbox + CSP is the second boundary; CSS and data images remain usable offline.
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"><style>:root{color-scheme:${dark ? 'dark' : 'light'}}body{margin:24px;color:${dark ? '#e4e4e7' : '#27272a'};background:${dark ? '#09090b' : '#fff'};font:14px/1.8 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%}pre{overflow:auto}*{box-sizing:border-box;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:#a1a1aa55 transparent}</style></head><body>${body}</body></html>`;
}
