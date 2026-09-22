import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRelease, releaseEndpoint } from '../electron/releases';
import { preferencesSchema } from '../src/shared/application';
const settings = { provider: 'github' as const, repository: 'https://github.com/example/app', automatic: true };
const reply = (data: unknown, status = 200) => (async () => new Response(JSON.stringify(data), { status })) as typeof fetch;
test('release providers resolve GitHub, enterprise GitHub and nested GitLab paths', () => {
  assert.equal(releaseEndpoint(settings), 'https://api.github.com/repos/example/app/releases/latest');
  assert.equal(releaseEndpoint({ ...settings, repository: 'https://code.example/team/app.git' }), 'https://code.example/api/v3/repos/team/app/releases/latest');
  assert.equal(releaseEndpoint({ ...settings, provider: 'gitlab', repository: 'https://gitlab.com/team/group/app' }), 'https://gitlab.com/api/v4/projects/team%2Fgroup%2Fapp/releases/permalink/latest');
  for (const repository of ['http://github.com/a/b', 'https://token@github.com/a/b', 'https://github.com/a/b?token=x', 'https://github.com/a']) assert.throws(() => releaseEndpoint({ ...settings, repository }));
});
test('checks stable versions without upgrades, execution or assumptions about release existence', async () => {
  const release = { tag_name: 'v1.10.0', html_url: settings.repository + '/releases/tag/v1.10.0', body: 'Release notes' };
  assert.equal((await checkRelease('1.9.0', settings, reply(release))).status, 'available');
  assert.equal((await checkRelease('1.10.0', settings, reply(release))).status, 'current');
  assert.equal((await checkRelease('2.0.0', settings, reply(release))).status, 'current');
  assert.equal((await checkRelease('1.0.0', settings, reply({}, 404))).status, 'error');
  assert.equal((await checkRelease('1.0.0', settings, reply({ ...release, html_url: 'https://evil.example/file' }))).status, 'error');
  assert.equal((await checkRelease('1.0.0', settings, reply({ ...release, tag_name: 'v3.0.0-beta.1' }))).status, 'error');
  assert.equal((await checkRelease('1.0.0', { ...settings, repository: '' })).status, 'unconfigured');
  assert.deepEqual(preferencesSchema.parse({}).theme, 'system');
});

test('user preferences cannot supply an application update repository', () => {
  const input = preferencesSchema.parse({ updates: { automatic: false, provider: 'github', repository: 'https://example.invalid/other/app' } });
  assert.deepEqual(input.updates, { automatic: false });
});

test('beta clients check public prereleases while excluding drafts and selecting newest SemVer', async () => {
  const releases = ['0.1.0-beta.1', '0.1.0-beta.2', '0.1.0-beta.10'].map(version => ({ tag_name: `v${version}`, prerelease: true, html_url: `${settings.repository}/releases/tag/v${version}` }));
  const fetcher = (async (url: string) => { assert.match(url, /releases\?per_page=30$/); return new Response(JSON.stringify([...releases, { ...releases[0], tag_name: 'v9.0.0', draft: true }])); }) as typeof fetch;
  const result = await checkRelease('0.1.0-beta.1', settings, fetcher);
  assert.equal(result.status, 'available'); assert.equal(result.version, '0.1.0-beta.10');
  assert.equal((await checkRelease('0.1.0-beta.10', settings, reply(releases))).status, 'current');
  assert.equal((await checkRelease('0.1.0-beta.1', settings, reply([]))).status, 'current');
  assert.equal((await checkRelease('0.1.0-beta.1', settings, reply([{ ...releases[0], tag_name: 'v0.1.0', prerelease: false }]))).version, '0.1.0');
});
