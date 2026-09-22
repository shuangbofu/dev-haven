import { valid, gt, prerelease, rcompare } from 'semver';
import type { ReleaseSource, ReleaseCheck } from '../src/shared/application';

export function releaseEndpoint(updates: ReleaseSource) {
  const url = new URL(updates.repository);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('请填写不含凭据的 HTTPS 仓库地址');
  const segments = url.pathname.replace(/\.git\/?$/, '').split('/').filter(Boolean);
  if (segments.length < 2 || segments.some(segment => !/^[a-zA-Z0-9_.-]+$/.test(segment) || /^\.{1,2}$/.test(segment))) throw new Error('仓库地址无效');
  if (updates.provider === 'github') {
    if (segments.length !== 2) throw new Error('GitHub 仓库地址应为 /owner/repository');
    return `${url.hostname === 'github.com' ? 'https://api.github.com' : `${url.origin}/api/v3`}/repos/${segments.join('/')}/releases/latest`;
  }
  return `${url.origin}/api/v4/projects/${encodeURIComponent(segments.join('/'))}/releases/permalink/latest`;
}
export async function checkRelease(current: string, updates: ReleaseSource, fetcher: typeof fetch = fetch): Promise<ReleaseCheck> {
  if (!updates.repository) return { status: 'unconfigured' };
  const checkedAt = new Date().toISOString();
  try {
    const betaChannel = !!prerelease(current) && updates.provider === 'github';
    const endpoint = releaseEndpoint(updates);
    const response = await fetcher(betaChannel ? endpoint.replace(/\/latest$/, '?per_page=30') : endpoint, { headers: { Accept: 'application/json', 'User-Agent': 'DevHaven' }, signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new Error(response.status === 404 ? '未找到公开 Release，请确认仓库地址及发布状态' : response.status === 403 || response.status === 429 ? '服务限流或仓库需要授权，请稍后重试' : `发布服务返回 HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error('发布信息过大');
    let body = ''; const reader = response.body?.getReader();
    if (!reader) throw new Error('发布服务返回空响应');
    const decoder = new TextDecoder(); let size = 0;
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) throw new Error('发布信息过大'); body += decoder.decode(value, { stream: true }); } body += decoder.decode(); }
    finally { await reader.cancel(); }
    const payload = JSON.parse(body);
    const data = betaChannel ? (Array.isArray(payload) ? payload : []).filter(item => !item.draft && typeof item.tag_name === 'string' && valid(item.tag_name)).sort((a, b) => rcompare(a.tag_name, b.tag_name))[0] : payload;
    if (!data) return { status: 'current', checkedAt, version: current };
    const version = typeof data.tag_name === 'string' ? valid(data.tag_name) : null;
    if (!version || !valid(current)) throw new Error('版本号必须使用 SemVer，例如 v1.2.3');
    if (data.draft || !betaChannel && (data.prerelease || prerelease(version))) throw new Error('此发布是草稿或预发布版本，请发布稳定版本');
    const url = new URL(updates.provider === 'github' ? data.html_url : data._links?.self);
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== new URL(updates.repository).origin) throw new Error('发布页面地址无效');
    return { status: gt(version, current) ? 'available' : 'current', checkedAt, version, url: url.href, notes: String(data.body ?? data.description ?? '').slice(0, 12000) };
  } catch (error) { return { status: 'error', checkedAt, error: error instanceof Error ? error.message : '检查失败' }; }
}
