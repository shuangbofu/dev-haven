# Discover the user's workspace

## Read the live catalog

Run the Skill's `scripts/context.mjs`, then the returned client's `context` command. Reuse this result within the current task and refresh before changing metadata or when the user changes source settings. Discovery works from persisted memory even while the application is closed.

| Context field | What it tells the agent |
| --- | --- |
| `sources` | Each configured source's ID, name, kind (`knowledge` or `projects`), absolute directory, scan setting and exclusions. Multiple roots are supported. |
| `entities` | Registered collections, project groups and whole projects, linked to a source by `sourceId` and a source-relative `path`. |
| `metadata.name`, `description`, `tags` | Registered identity, purpose, scope and topics. These are the starting point for understanding where content belongs. |
| `metadata.languages`, `git`, `launch` | Registered technologies, remote and declarative launch configuration when present. They do not prove runtime installation or running status. |
| `metadataEvidence` | Source-relative files supporting the registered description, when available; read relevant files to understand details or verify an outdated description. |
| `memoryDirectory`, `reportsDirectory` | The configured central-memory and personal-report locations. Reports are their own output, not a knowledge collection. |

Sources currently have a name and directory, but no separate purpose field. A registered collection at `path: ""` describes that root. Collection descriptions can explain intended scope and organization when supported by user instructions or source documents. There are no arbitrary custom metadata fields; use the supported [format](format.md).

## Resolve location and ownership

Join each entity to its source by `sourceId`. Its physical directory is the source directory plus its forward-slash relative path; the empty path is the source root. Use the host platform's path library, never a username, fixed drive, guessed home directory or string-prefix-only containment check. Resolve and check containment before accessing files; respect configured exclusions and do not traverse symlinks outside the source.

Within one source, a collection is an ancestor only if its path is empty or matches complete leading path segments. The nearest registered ancestor describes the parent group. Ordinary intervening folders do not become knowledge libraries or projects merely because they exist. Keep distinct source IDs separate even if names match. For overlapping roots, use the entity's registered source; for an unregistered target, prefer the most specific containing source and surface a genuine unresolved ambiguity.

## Understand and locate content

1. Match the user's intent against names, descriptions, tags and registered hierarchy across the configured sources. Do not restrict discovery to the current shell directory or names alone.
2. Read the relevant collection/project description and supporting evidence. For finer detail, inspect its README, index or selected documents using normal read-only filesystem tools. Use `search --query "keywords"` or MCP `devhaven_search` to locate document bodies and README matches in the local index; see [search integration](search.md). Check `indexedAt` and warnings, then read the relevant live files before editing. Context itself is not a per-document catalog.
3. Answer with the matching library/project, resolved path, documented purpose and relevant entry documents. Separate registered metadata from newly verified file content. Mention a missing location or insufficient description when it affects the answer.
4. For new content, choose a destination using explicit user location, then documented collection scope and existing organization. A registered project is one whole project. Do not scatter its code across groups or register each folder as a new project. If multiple destinations remain equally plausible, ask only for the unresolved choice.

Descriptions that merely repeat a folder name or a timestamp do not explain purpose. Do not infer ownership, company/personal categories, archival rules or completeness from a directory label. Existing registration is not proof that every statement is current. Missing semantic details can be established by reading evidence or asking the user; they cannot be invented by the Skill.

Pure lookup never mutates metadata or creates a changelog. When authorized management work establishes or corrects a collection's meaning, preserve its full valid metadata and submit `metadataOnly: true` through the client, checking the receipt. This keeps personal organization in central memory so future agents can discover it, without copying machine-specific directory maps into global instructions or this Skill.
