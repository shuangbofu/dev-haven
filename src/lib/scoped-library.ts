import type { DesktopAPI, LibraryClient } from '@/shared/types';

export function scopedLibrary(api: DesktopAPI, sourceId: string): LibraryClient {
  const call = <T>(operation: string, input?: Record<string, unknown>) => api.libraryCall(sourceId, operation, input) as Promise<T>;
  return { ...api,
    librarySettings: () => call('settings'),
    libraryBrowse: (_kind, path) => call('browse', { path }),
    libraryProjects: () => call('projects'), libraryOverview: () => call('overview'),
    libraryProjectReadme: path => call('readme', { path }),
    libraryHistory: (path, query) => call('history', { path, query }),
    libraryGitHistory: (path, page, revision) => call('git-history', { path, page, revision }),
    libraryRead: (_kind, path) => call('read', { path }),
    librarySaveMetadata: ({ kind: _kind, ...input }) => call('metadata', input),
    librarySaveDocument: (_kind, path, content, revision) => call('save', { path, content, revision }),
    libraryCreate: (_kind, path, name, directory, expectedRoot) => call('create', { path, name, directory, expectedRoot }),
    libraryDestinationFolders: (_kind, path) => call('destination-folders', { path }),
    libraryReveal: (_kind, path) => call('reveal', { path }),
    libraryOpenDocument: path => call('open-document', { path }),
    libraryOpenProject: (path, target) => call('open-project', { path, target }),
    libraryPullProject: path => call('pull', { path }),
    libraryCloneProject: (remote, name, parent, expectedRoot) => call('clone', { remote, name, parent, expectedRoot }),
  };
}
