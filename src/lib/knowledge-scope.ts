/** Source-relative paths use '/' on every platform. */
export function inCollection(root: string, target: string) {
  if (target.includes('\\') || target.startsWith('/') || target.split('/').some(part => part === '..' || part === '.')) return false;
  return root === '' ? !target.includes('/') : target === root || target.startsWith(`${root}/`);
}

export function collectionForDocument(paths: string[], document: string): string {
  return paths.filter(root => root && inCollection(root, document)).sort((a, b) => b.length - a.length)[0] ?? '';
}

export function collectionAncestors(root: string, folder: string): string[] {
  if (!inCollection(root, folder)) return [];
  const parts = folder.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/')).filter(item => inCollection(root, item));
}
