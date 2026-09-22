import { build } from 'esbuild';
import { chmod, cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const publish = Array.isArray(manifest.build?.publish) ? manifest.build.publish[0] : manifest.build?.publish;
let releaseSource;
if (publish) {
  if (publish.provider !== 'github' || !/^[\w.-]+$/.test(publish.owner ?? '') || !/^[\w.-]+$/.test(publish.repo ?? '')) throw new Error('Configure build.publish with the application GitHub owner and repo');
  releaseSource = { provider: 'github', repository: `https://github.com/${publish.owner}/${publish.repo}` };
}
await rm('dist-electron', { recursive: true, force: true });
await build({
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts', 'memory-client': 'electron/memory-client.ts', 'search-worker': 'electron/search-worker.ts' },
  outdir: 'dist-electron', outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  define: { __DEVHAVEN_RELEASE_SOURCE__: JSON.stringify(releaseSource ?? null) },
  external: ['electron'], sourcemap: false, minify: true, legalComments: 'eof',
});
await rm('dist-electron/skills/devhaven-metadata', { recursive: true, force: true });
await cp('skills/devhaven-metadata', 'dist-electron/skills/devhaven-metadata', { recursive: true, filter: source => !source.split(path.sep).includes('__pycache__') && !/\.py[co]$/.test(source) });
const destination = 'dist-electron/vendor/node-pty';
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const entry of ['package.json', 'LICENSE', 'lib', `prebuilds/${process.platform}-${process.arch}`, 'build/Release']) {
  try {
    await cp(`node_modules/node-pty/${entry}`, `${destination}/${entry}`, {
      recursive: true,
      filter: source => !/\.(pdb|map)$|\.test\.js$|[\\/]obj(?:[\\/]|$)/.test(source),
    });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
// node-pty's macOS prebuilds can ship spawn-helper without executable bits.
// Preserve a runnable helper in both development and packaged ASAR resources.
if (process.platform !== 'win32') {
  for (const entry of await readdir(destination, { recursive: true })) {
    if (path.basename(entry) === 'spawn-helper') await chmod(path.join(destination, entry), 0o755);
  }
}
