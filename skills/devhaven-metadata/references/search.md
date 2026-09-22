# Indexed search and MCP

Discover `clientFile` with the Skill's `scripts/context.mjs`. Use the returned path rather than assuming a memory directory.

```sh
node "<clientFile>" search --query "关键词" --kind all --page 1
node "<clientFile>" search-status
```

`kind` is `all`, `document` or `project`; each page contains at most 30 results. Space-separated words are AND-matched across title, path, metadata and document/README body. Results include `sourceId`, source-relative `path`, snippet, `matchedIn`, `indexedAt`, `partial` and warnings. Match the source ID to the context before resolving a path. Read the current file before making an edit or presenting exact quotations.

The application builds a local snapshot at startup, after metadata and in-app content changes, and once per minute while open. Unchanged file contents are reused. The app offers manual rebuilding in Settings → 本地搜索索引. CLI/MCP search only reads this index: it works while the app is closed but cannot promise current external edits are indexed. Missing index, changed source configuration, excluded paths and unreadable files are surfaced rather than silently crawling another location. Search and status never create change records. Do not use the index timestamp as the occurrence time of user work.

## stdio MCP server

Launch the discovered client with the argument `mcp`:

```json
{
  "command": "node",
  "args": ["<clientFile>", "mcp"]
}
```

This is a generic stdio server descriptor; adapt it to the coding agent's MCP configuration syntax and substitute the discovered client path. Install/register it only when the user requests configuration; the Skill itself does not automatically register an MCP server. If MCP is not configured, use the CLI immediately instead of treating integration setup as a prerequisite.

Tools:

- `devhaven_search`: `{ "query": "关键词", "kind": "all", "page": 1 }`.
- `devhaven_context`: configured roots and registered metadata/purposes.
- `devhaven_search_status`: persisted index freshness, entry count and diagnostics.

All three are read-only. The server uses stdio, opens no network port, executes no project commands and does not call a model service. Context and snippets contain the user's local information; only request and expose material relevant to the current task. Recording verified work still uses `record` and its accepted receipt, as described in the main Skill.
