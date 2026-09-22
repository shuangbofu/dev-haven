# Central record format

The client obtains paths and source IDs from runtime configuration, on macOS, Linux and Windows:

```sh
node "<client-file>" context
node "<client-file>" record --file "<payload-file>"
```

Example payload (replace the IDs and timestamp with real values):

```json
{
  "version": 1,
  "id": "fdbe5916-d7f7-4f91-a099-4f2a4ad41a9d",
  "sourceId": "a3b524ae-6e72-45be-a89b-d0551fcfb626",
  "path": "team/example",
  "occurredAt": "2026-09-18T10:00:00+08:00",
  "message": "Added the settings form and verified its validation tests.",
  "evidence": ["team/example/src/settings.tsx"],
  "metadata": {
    "schemaVersion": 1,
    "kind": "project",
    "name": "Example 设置管理工具",
    "description": "用于维护应用设置的工具。",
    "languages": ["TypeScript"],
    "tags": ["web"],
    "git": { "remote": "https://github.com/example/example.git", "provider": "github" },
    "launch": {
      "command": "npm",
      "args": ["run", "dev"],
      "cwd": "web",
      "previewUrl": "http://localhost:3000/"
    }
  }
}
```

`metadata` is optional for a change to an already registered entity; when supplied it replaces that entity's metadata. Read existing metadata from `context` and preserve verified fields. Required metadata fields: `schemaVersion: 1`, `kind: "project" | "collection"`, `name`. Description, languages and tags default to empty. Unknown keys are rejected. Knowledge sources only allow collections. The entity path must be a directory when supplying metadata. Use factual Chinese names and descriptions based on project/document evidence; preserve real product names. A directory's name or language alone is not sufficient evidence of its purpose.

The CLI record schema has no optimistic-revision field. Do not copy the entity's `revision`, `id`, `registration` or `updatedAt` into `metadata`. Re-read context immediately before replacing metadata, preserve its verified Git/launch fields, and avoid concurrent metadata writers. Metadata writes are not partial patches. There are no environment requirements, ports list, process status or custom arbitrary fields in this schema; do not invent them.

`git` is optional. Provider: `github`, `gitlab`, `enterprise`, `other`. Remotes accept credential-free HTTP(S), SSH or Git addresses, including `git@host:team/repo.git`. Reject passwords, HTTP usernames, query tokens, local paths and executable transport helpers. The installed Git client's credentials handle authentication.

`launch` is optional and declarative. `command` is an executable name, `args` is a string array, `cwd` is project-relative with forward slashes, `previewUrl` is localhost HTTP(S). No shell pipelines, OS-specific absolute paths or guessed ports. The first version displays this convention; it does not run project processes.

`path` and each evidence path are source-relative, use forward slashes, and cannot escape the source or traverse symlinks, hidden folders or exclusions. Evidence must exist. Root path is the empty string. Do not use an absolute source path in these fields. The record ID is a UUID used for deduplication; retain it when retrying. The client can fill version, UUID, current timestamp and empty evidence, but explicit IDs make retries reproducible.

The app consumes `inbox/*.json` and writes `receipts/<id>.json.status`. Accepted records become centralized entities/events in `state.json`. Never edit state directly. Record once at the affected entity; parent histories aggregate descendant events. App clone, pull and document edits record automatically; do not duplicate them. When the app is closed, keep the queued payload and receipt ID. Evidence should point to the changed code or document.


The platform assigns each entity a registration method independently of Git repository/provider information: `manual`, `git`, `agent`, or `scan`. Editing metadata preserves the original method. Do not put this field in a record's `metadata` object or infer Git import from the presence of `.git`.

`metadataOnly: true` requires `metadata` and applies it without creating a change event. Use it for placeholder cleanup and metadata corrections, not real project/document work. The payload still has a UUID and receipt for safe retries.

Events distinguish `git` (only the exact configured Git author email; real author time and commit hash), `agent` (Skill records), `scan` (discovery only, no claimed occurrence time or daily-report credit) and `app` (application operations). Clone/pull operations do not count as personal code changes. Unknown dates must not be replaced by file modification or import times. Source changelogs are not personal change evidence.
