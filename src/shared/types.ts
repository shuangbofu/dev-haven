import type { ApplicationState, Preferences } from './application';
import type { SearchIndexStatus } from './search';
import type { ToolId } from './catalog';
import type { SearchQuery, SearchResults } from './search';
import type { ReportPeriod, EventQuery, MemoryEvent, MemoryConfig, MemorySnapshot } from './memory';
import type { Page } from './pagination';
import type { GitCommit } from './library';
import type { DirectoryListing, DestinationListing, LibraryDocument, LibraryEntry, LibraryKind, LibraryOverview, LibrarySettings, MetadataWrite, ProjectListing } from './library';
export interface Installation { id: string; tool: ToolId; version: string; path: string; binPaths: string[]; installedAt: string; isDefault: boolean }
export interface SystemTool { tool: ToolId; version: string; path: string }
export interface Task { id: string; kind: 'bootstrap' | 'install' | 'uninstall' | 'default'; tool?: ToolId; version?: string; status: 'queued' | 'running' | 'success' | 'failed'; createdAt: string; finishedAt?: string; logs: string[]; error?: string }
export interface Snapshot { platform: string; arch: string; hostname: string; root: string; engineReady: boolean; engineVersion: string; installations: Installation[]; systemTools: SystemTool[]; tasks: Task[]; scanTime?: string }
export interface Manifest { format: 'devhaven'; schemaVersion: 1; name: string; exportedAt: string; source: { platform: string; arch: string }; tools: { id: ToolId; version: string; default: boolean }[] }
export interface ImportPlan { manifest: Manifest; items: { tool: ToolId; version: string; action: 'install' | 'installed'; setDefault: boolean }[]; warnings: string[] }
export interface TerminalSession { id: string; title: string; cwd: string; installationId?: string }
export type TerminalEvent = { id: string; type: 'data'; data: string } | { id: string; type: 'exit'; exitCode: number };
export interface ShellIntegrationStatus { supported: boolean; enabled: boolean; shell: string; configFile: string; configFiles: string[]; scriptFile: string; backupFile?: string; error?: string }
export interface DesktopAPI {
  application(): Promise<ApplicationState>;
  savePreferences(preferences: Preferences): Promise<ApplicationState>;
  checkUpdates(): Promise<ApplicationState>;
  onApplicationChange(callback: (state: ApplicationState) => void): () => void;
  searchStatus(): Promise<SearchIndexStatus>;
  rebuildSearch(): Promise<SearchIndexStatus>;
  search(query: SearchQuery): Promise<SearchResults>;
  cancelSearch(): Promise<void>;
  memorySnapshot(): Promise<MemorySnapshot>;
  memoryEvents(query: EventQuery): Promise<Page<MemoryEvent>>;
  memorySaveConfig(config: MemoryConfig): Promise<MemorySnapshot>;
  memoryChoosePath(purpose: 'source' | 'memory' | 'reports' | 'agent'): Promise<string | null>;
  memoryScan(sourceId: string): Promise<string>;
  memoryCancel(id: string): Promise<void>;
  memoryReport(date: string, period?: ReportPeriod): Promise<string>;
  memorySaveReport(id: string, content: string, revision: string): Promise<MemorySnapshot>;
  memoryReveal(target: 'memory' | 'reports' | 'skill'): Promise<void>;
  onMemoryChange(callback: (snapshot: MemorySnapshot) => void): () => void;
  libraryCall(sourceId: string, operation: string, input?: Record<string, unknown>): Promise<unknown>;
  openLink(url: string): Promise<void>;
  shellStatus(): Promise<ShellIntegrationStatus>;
  setShellEnabled(enabled: boolean): Promise<ShellIntegrationStatus>;
  snapshot(): Promise<Snapshot>;
  bootstrap(): Promise<void>;
  scan(): Promise<Snapshot>;
  versions(tool: ToolId): Promise<string[]>;
  install(tool: ToolId, version: string): Promise<void>;
  uninstall(id: string): Promise<void>;
  setDefault(id: string): Promise<void>;
  terminal(id?: string, repl?: boolean): Promise<TerminalSession>;
  terminalAttach(id: string): Promise<{ output: string; exitCode?: number }>;
  terminalWrite(id: string, data: string): Promise<void>;
  terminalResize(id: string, cols: number, rows: number): Promise<void>;
  terminalClose(id: string): Promise<void>;
  onTerminalEvent(callback: (event: TerminalEvent) => void): () => void;
  reveal(path: string): Promise<void>;
  exportManifest(name: string): Promise<string | null>;
  previewImport(): Promise<ImportPlan | null>;
  applyImport(manifest: Manifest): Promise<void>;
  onChange(callback: (snapshot: Snapshot) => void): () => void;
}
export interface LibraryClient extends DesktopAPI {
  librarySettings(): Promise<LibrarySettings>;
  libraryDestinationFolders(kind: LibraryKind, path: string): Promise<DestinationListing>;
  libraryBrowse(kind: LibraryKind, path: string): Promise<DirectoryListing>;
  libraryProjects(): Promise<ProjectListing>;
  libraryProjectReadme(path: string): Promise<LibraryDocument | null>;
  libraryHistory(path: string, query: EventQuery): Promise<Page<MemoryEvent>>;
  libraryGitHistory(path: string, page: number, revision?: string): Promise<Page<GitCommit> & { revision: string }>;
  libraryOverview(): Promise<LibraryOverview>;
  libraryRead(kind: LibraryKind, path: string): Promise<LibraryDocument>;
  librarySaveMetadata(input: MetadataWrite): Promise<void>;
  librarySaveDocument(kind: LibraryKind, path: string, content: string, revision: string): Promise<LibraryDocument>;
  libraryCreate(kind: LibraryKind, path: string, name: string, directory: boolean, expectedRoot?: string): Promise<string>;
  libraryReveal(kind: LibraryKind, path: string): Promise<void>;
  libraryOpenDocument(path: string): Promise<void>;
  libraryOpenProject(path: string, target: 'finder' | 'vscode'): Promise<void>;
  libraryPullProject(path: string): Promise<LibraryEntry>;
  libraryCloneProject(remote: string, name: string, parent: string, expectedRoot?: string): Promise<LibraryEntry>;
}
declare global { interface Window { devhaven?: DesktopAPI } }
