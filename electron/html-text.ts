import { parse, type DefaultTreeAdapterTypes } from 'parse5';
/** Index human-readable HTML text, not styles, scripts or embedded image payloads. */
export function htmlText(input: string): string {
  const parts: string[] = [];
  const visit = (node: DefaultTreeAdapterTypes.ChildNode) => {
    if ('tagName' in node && ['script', 'style', 'template', 'noscript'].includes(node.tagName)) return;
    if (node.nodeName === '#text' && 'value' in node) parts.push(node.value);
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  };
  for (const node of parse(input).childNodes) visit(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
