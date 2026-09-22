import { get } from 'node:https';
import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import { iconSourceSchema } from '../src/shared/technology-icons';
import { validateIcon } from './local-icons';

function publicAddress(address: string) {
  if (address.includes(':')) return /^[23]/.test(address);
  const [a, b] = address.split('.').map(Number);
  return ![0, 10, 127].includes(a) && a < 224 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127);
}
export async function downloadIcon(input: string, signal?: AbortSignal, redirects = 0): Promise<Buffer> {
  const url = new URL(iconSourceSchema.parse(input));
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) && !publicAddress(hostname)) throw new Error('图标地址不是公网地址');
  if (redirects > 5 || url.hostname === 'localhost' || url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost')) throw new Error('图标地址必须是公开 HTTPS 资源');
  const data = await new Promise<Buffer>((resolve, reject) => {
    const request = get(url, { headers: { 'User-Agent': 'DevHaven', Accept: 'image/svg+xml,image/png,*/*;q=0.5' }, signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]), lookup: (hostname, options, callback) => {
      lookup(hostname, { all: true }, (error, addresses) => {
        if (error) return callback(error, []);
        if (!addresses.length || addresses.some(item => !publicAddress(item.address))) return callback(new Error('图标地址不是公网地址'), []);
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      });
    } }, response => {
      if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) { response.resume(); void downloadIcon(new URL(response.headers.location, url).href, signal, redirects + 1).then(resolve, reject); return; }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`图标下载失败：HTTP ${response.statusCode}`)); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 512 * 1024) response.destroy(new Error('图标超过 512 KB')); else chunks.push(chunk); });
      response.on('error', reject); response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('error', reject);
  });
  validateIcon(data);
  return data;
}
