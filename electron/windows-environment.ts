import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { enginePaths } from './engine';
import { run } from './process';
import type { ShellIntegrationStatus } from '../src/shared/types';

const valueSchema = z.object({ value: z.string(), kind: z.enum(['String', 'ExpandString']) });
export type WindowsValue = z.infer<typeof valueSchema>;
export type WindowsValues = Record<string, WindowsValue>;
export interface WindowsEnvironmentStore {
  read(names: string[]): Promise<WindowsValues>;
  write(values: Record<string, WindowsValue | null>): Promise<void>;
}
const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
const decodeScript = (value: unknown) => `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(value)}')) | ConvertFrom-Json`;
export class RegistryEnvironmentStore implements WindowsEnvironmentStore {
  private exec(script: string) {
    // Resolve Windows PowerShell from the OS directory, not a fixed drive or user path.
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
    if (!systemRoot) throw new Error('无法确定 Windows 系统目录，未修改用户环境变量。');
    const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const prefix = "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false);\n";
    return run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(prefix + script, 'utf16le').toString('base64')], { timeout: 30_000 });
  }
  async read(names: string[]) {
    const output = await this.exec(`$names = ${decodeScript(names)}
$result = @{}
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
try {
  foreach ($name in $names) {
    if ($null -ne $key) {
      $value = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      if ($null -ne $value) { $result[$name] = @{ value = [string]$value; kind = [string]$key.GetValueKind($name) } }
    }
  }
} finally { if ($null -ne $key) { $key.Dispose() } }
ConvertTo-Json -InputObject $result -Compress -Depth 4`);
    return z.record(z.string(), valueSchema).parse(JSON.parse(output));
  }
  async write(values: Record<string, WindowsValue | null>) {
    await this.exec(`$values = ${decodeScript(values)}
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
try {
  foreach ($property in $values.PSObject.Properties) {
    if ($null -eq $property.Value) { $key.DeleteValue($property.Name, $false) }
    else { $key.SetValue($property.Name, $property.Value.value, [Microsoft.Win32.RegistryValueKind]$property.Value.kind) }
  }
} finally { $key.Dispose() }
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DevHavenEnvironmentNotification { [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r); }'
$result = [UIntPtr]::Zero
[void][DevHavenEnvironmentNotification]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)`);
  }
}
const recordSchema = z.object({ version: z.literal(1), enabled: z.boolean(), backupFile: z.string(), original: z.record(z.string(), valueSchema), applied: z.record(z.string(), valueSchema) });
const same = (a: WindowsValue | undefined, b: WindowsValue | undefined) => a?.value === b?.value && a?.kind === b?.kind;
const equalPath = (a: string, b: string) => path.win32.normalize(a.trim().replace(/^"|"$/g, '')).replace(/\\$/, '').toLowerCase() === path.win32.normalize(b).replace(/\\$/, '').toLowerCase();

export class WindowsEnvironmentIntegration {
  private directory: string;
  private recordFile: string;
  readonly entries: string[];
  readonly variables: Record<string, string>;
  constructor(private root: string, private store: WindowsEnvironmentStore = new RegistryEnvironmentStore(), storageDirectory?: string) {
    this.directory = storageDirectory ?? path.join(root, 'shell');
    this.recordFile = path.join(this.directory, 'windows-environment.json');
    this.entries = [path.win32.join(root, 'data', 'shims'), path.win32.join(root, 'engine')];
    this.variables = { ...enginePaths(root, 'win32'), MISE_NOT_FOUND_AUTO_INSTALL: '0' };
  }
  private async record() {
    try { return recordSchema.parse(JSON.parse(await readFile(this.recordFile, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  private async save(record: z.infer<typeof recordSchema>) {
    await writeFile(`${this.recordFile}.tmp`, JSON.stringify(record, null, 2), { mode: 0o600 });
    await rename(`${this.recordFile}.tmp`, this.recordFile);
  }
  async status(): Promise<ShellIntegrationStatus> {
    const base = { supported: true, shell: 'Windows', configFile: 'HKEY_CURRENT_USER\\Environment', configFiles: ['HKEY_CURRENT_USER\\Environment'], scriptFile: this.entries[0] };
    try {
      const record = await this.record();
      const values = await this.store.read(['Path', ...Object.keys(this.variables)]);
      const matches = this.entries.every(entry => (values.Path?.value ?? '').split(';').some(part => equalPath(part, entry)))
        && Object.entries(this.variables).every(([key, value]) => values[key]?.value === value);
      return { ...base, enabled: !!record?.enabled && matches, backupFile: record?.backupFile,
        error: record?.enabled && !matches ? '用户环境变量已被修改，可重新开启以修复。' : undefined };
    } catch (error) { return { ...base, enabled: false, error: String(error) }; }
  }
  async setEnabled(enabled: boolean) {
    const record = await this.record();
    const current = await this.store.read(['Path', ...Object.keys(this.variables)]);
    await mkdir(this.directory, { recursive: true });
    if (enabled) {
      if (current.MISE_DATA_DIR && !equalPath(current.MISE_DATA_DIR.value, this.variables.MISE_DATA_DIR)) throw new Error('检测到另一套 mise 用户环境，请先停用旧配置，避免环境冲突。');
      const existing = (current.Path?.value ?? '').split(';').filter(part => !this.entries.some(entry => equalPath(part, entry)));
      const applied: WindowsValues = Object.fromEntries(Object.entries(this.variables).map(([key, value]) => [key, { value, kind: 'String' as const }]));
      applied.Path = { value: [...this.entries, ...existing.filter(Boolean)].join(';'), kind: current.Path?.kind ?? 'ExpandString' };
      const original = record?.enabled ? record.original : current;
      const backupFile = record?.enabled ? record.backupFile : path.join(this.directory, `windows-before-${randomUUID()}.json`);
      if (!record?.enabled) await writeFile(backupFile, JSON.stringify(original, null, 2), { mode: 0o600, flag: 'wx' });
      // Save recovery data before touching the registry; roll back partially written values on failure.
      await this.save({ version: 1, enabled: false, original, applied, backupFile });
      try {
        await this.store.write(applied);
        await this.save({ version: 1, enabled: true, original, applied, backupFile });
      } catch (error) {
        await this.store.write(Object.fromEntries(Object.keys(applied).map(key => [key, current[key] ?? null])));
        if (record) await this.save(record);
        throw error;
      }
    } else if (record) {
      const changes: Record<string, WindowsValue | null> = {};
      for (const key of Object.keys(this.variables)) if (same(current[key], record.applied[key])) changes[key] = record.original[key] ?? null;
      if (same(current.Path, record.applied.Path)) changes.Path = record.original.Path ?? null;
      else if (current.Path) changes.Path = { ...current.Path, value: current.Path.value.split(';').filter(part => !this.entries.some(entry => equalPath(part, entry))).join(';') };
      try { await this.store.write(changes); await this.save({ ...record, enabled: false }); }
      catch (error) { await this.store.write(Object.fromEntries(Object.keys(changes).map(key => [key, current[key] ?? null]))); throw error; }
    }
    await appendFile(path.join(this.directory, 'CHANGELOG.md'), `\n- ${new Date().toISOString()}：${enabled ? '开启' : '关闭'}当前用户 Windows 环境；仅修改 HKCU\\Environment，保留其他 PATH 项。\n`, { mode: 0o600 });
    return this.status();
  }
}
