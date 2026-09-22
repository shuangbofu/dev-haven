import { documentType } from '@/shared/document-format';
import { FileCode2, FileText } from 'lucide-react';
export function DocumentIcon({ path, size = 16 }: { path: string; size?: number }) {
  const html = /\.html?$/i.test(path), markdown = /\.(md|markdown)$/i.test(path);
  const code = documentType(path).format === 'code';
  const Icon = html || code ? FileCode2 : FileText;
  return <Icon size={size} className={html ? 'document-icon-html' : markdown ? 'document-icon-markdown' : code ? 'document-icon-code' : 'document-icon-text'} aria-label={html ? 'HTML 文档' : markdown ? 'Markdown 文档' : code ? '代码文件' : '文本文档'} />;
}
