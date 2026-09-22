# DevHaven 记录约定

本项目的开发、文档、元数据及平台变更统一使用 `skills/devhaven-metadata/SKILL.md` 的集中记忆客户端记录，并检查 receipt。父级记录由平台聚合。

平台记忆保存在配置的记忆目录，来源目录保存代码与文档。应用关闭时保留待处理记录。数据维护不记工作变更；仅更新元数据时使用客户端的 `metadataOnly: true`。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
