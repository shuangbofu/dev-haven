import { pathToFileURL } from 'node:url';

/** VS Code expects a URI path, including the drive or UNC host on Windows. */
export function editorURL(absolutePath: string, platform: NodeJS.Platform = process.platform): string {
  const file = pathToFileURL(absolutePath, { windows: platform === 'win32' });
  return `vscode://file${file.hostname ? `//${file.hostname}` : ''}${file.pathname}`;
}
