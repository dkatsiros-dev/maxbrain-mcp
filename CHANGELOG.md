# Changelog

All notable changes to `@dkatsiros/notion-brain` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.4.0] — 2026-04-19

### Added
- **Markdown rendering** across all content fields — `create_note`, `update_note`, `create_task`, `update_task` now parse Markdown into proper Notion blocks (headings, bullets, numbered lists, code blocks, quotes) and inline formatting (bold, italic, code, links). Powered by `@tryfabric/martian`.
- Tool descriptions updated to advertise Markdown support so LLMs use formatting instead of plain text.

### Changed
- `update_note` content replacement now deletes ALL child blocks (not just paragraphs) before appending new content — accommodates the richer block types.
- tsup config gained CJS-`require` shim so bundled CJS deps (vfile, etc.) work in ESM output.

## [1.3.0] — 2026-04-19

### Added
- `update_note` tool — update title, body content, project/area links, tags, favorite, archive flags
- Body content replacement deletes existing paragraph blocks and appends new ones (handles long text via `paragraphBlocks()`)

## [1.2.1] — 2026-04-19

### Fixed
- `create_note` — content longer than 2000 chars now splits into multiple paragraph blocks (Notion's per-block limit)
- `create_task` / `update_task` — Description field now handles >2000 char text via `richText()` chunking helper
- Added shared `richText()` and `paragraphBlocks()` helpers for safe long-text handling across all tools

## [1.2.0] — 2026-04-13

### Added
- `snooze_task` tool — set/clear a task's Snooze date
- `get_blocked_tasks` tool — tasks with non-empty "Blocked by" relation (excludes done)
- `get_reminders` tool — notes with "Remind Me Date"; defaults to today/past, `include_future` flag
- `PROPERTY_DEFAULTS` extended: Tasks.Snooze, Tasks."Blocked by", Notes."Remind Me Date", Notes.Fleeting, Notes.URL (validated on startup)

## [1.1.0] — 2026-04-13

### Added
- `update_project` tool — update name, status, area relation, archive flag
- `update_task` tool — update title, description, done_status, priority, due, project, tags, assignee
- `LICENSE` file (MIT)
- npm metadata: `repository`, `bugs`, `homepage`, `author`
- README badges (npm version, license)

### Changed
- Renamed env var `ULTIMATE_BRAIN_PAGE_ID` → `MAX_BRAIN_PAGE_ID` (also accepts `ROOT_PAGE_ID`)

## [1.0.0] — 2026-04-13

### Added
- Initial release
- 10 MCP tools: `search`, `get_projects`, `create_project`, `get_tasks`, `create_task`, `complete_task`, `get_notes`, `create_note`, `get_goals`, `get_daily_summary`
- Auto-discovery of 5 databases (Projects, Tasks, Notes, Areas/Resources, Goals) from "Max Brain" root page
- Schema validation + dynamic tool descriptions from live Notion schema
- Flexible status matching via LLM-facing descriptions (no code-level normalizer)
- Works with Claude Code, Gemini CLI, Cursor, Cline, Continue, Claude Desktop
- Smoke test suite (vitest) — 4 tests covering startup behavior and package integrity
