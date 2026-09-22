/** Shared by file reads, icons and the source viewer; never infer language from content. */
const languages: Record<string, string> = {
  json: 'json', jsonc: 'json', css: 'css', scss: 'scss', less: 'less',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  java: 'java', go: 'go', rs: 'rust', py: 'python', pyw: 'python',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', xml: 'xml', svg: 'xml',
  sh: 'bash', bash: 'bash', zsh: 'bash', sql: 'sql', c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php',
  swift: 'swift', kt: 'kotlin', kts: 'kotlin', dart: 'dart', vue: 'xml', svelte: 'xml',
};
export function documentType(file: string): { format: 'markdown' | 'html' | 'code' | 'text' | 'unsupported'; language?: string } {
  const name = file.split(/[\\/]/).at(-1)?.toLowerCase() ?? '';
  const extension = name.includes('.') ? name.split('.').at(-1)! : '';
  if (['md', 'markdown'].includes(extension)) return { format: 'markdown' };
  if (['html', 'htm'].includes(extension)) return { format: 'html' };
  const language = name === 'dockerfile' ? 'dockerfile' : languages[extension];
  if (language) return { format: 'code', language };
  return { format: ['txt', 'csv', 'tsv', 'log', 'rst'].includes(extension) ? 'text' : 'unsupported' };
}
