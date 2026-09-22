import { spawn } from 'node:child_process';
import electron from 'electron';
await import('./build-electron.mjs');
const web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1'], { stdio: 'inherit' });
let desktop;
let closing = false;
function stop() { if (closing) return; closing = true; desktop?.kill(); web.kill(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
web.on('exit', stop);
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (closing) process.exit(1);
    try { if ((await fetch('http://127.0.0.1:3000')).ok) break; } catch {}
    if (attempt === 119) throw new Error('Next.js 启动超时');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const env = { ...process.env, DEVHAVEN_DEV_URL: 'http://127.0.0.1:3000' };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = spawn(electron, ['.'], { stdio: 'inherit', env });
  desktop.on('exit', stop);
} catch (error) { console.error(error); stop(); process.exitCode = 1; }
