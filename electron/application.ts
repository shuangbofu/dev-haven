import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON } from './memory-files';
import { preferencesSchema, type ApplicationState, type Preferences, type ReleaseSource, type ReleaseCheck } from '../src/shared/application';
import { checkRelease } from './releases';
export class ApplicationSettings extends EventEmitter {
  private preferences = preferencesSchema.parse({});
  private release: ReleaseCheck = { status: 'unconfigured' };
  private checking?: Promise<ApplicationState>;
  constructor(private root: string, private version: string, private releaseSource?: ReleaseSource) { super(); }
  async init() {
    try { this.preferences = preferencesSchema.parse(JSON.parse(await readFile(path.join(this.root, 'preferences.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return this;
  }
  snapshot(): ApplicationState { return structuredClone({ version: this.version, updatesSupported: !!this.releaseSource, preferences: this.preferences, release: this.release }); }
  async save(input: Preferences) {
    const next = preferencesSchema.parse(input);
    await atomicJSON(path.join(this.root, 'preferences.json'), next);
    this.preferences = next;
    this.emit('change', this.snapshot()); return this.snapshot();
  }
  check() {
    if (this.checking) return this.checking;
    const updates = this.releaseSource;
    if (!updates) return Promise.resolve(this.snapshot());
    this.release = { status: updates.repository ? 'checking' : 'unconfigured' }; this.emit('change', this.snapshot());
    this.checking = checkRelease(this.version, updates).then(result => {
      this.release = result; this.emit('change', this.snapshot());
      return this.snapshot();
    }).finally(() => { this.checking = undefined; });
    return this.checking;
  }
}
