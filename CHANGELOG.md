# Changelog

All notable changes to `@dkatsiros/notion-brain` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.6.1] — 2026-04-19

### Added
- **`health_check` MCP tool** — exposes the doctor's logic to the LLM. When a tool fails with a cryptic Notion API error, the LLM can now call `health_check` to get a structured diagnosis (missing properties, status options, etc.) and tell the user exactly what to fix.
- `runHealthCheck()` exported from `src/doctor.ts` — pure function, no side effects, used by both the CLI and the MCP tool.

### Changed
- `doctor` CLI is now a thin wrapper around `runHealthCheck()` — same single source of truth as the MCP tool.

## [1.6.0] — 2026-04-19

### Added
- **`doctor` health-check command** — `npx -y @dkatsiros/notion-brain doctor` validates API key + auto-discovers your template + verifies every expected database, property type, and status option. Reports errors with concrete fix suggestions. Use it whenever an MCP tool starts failing or after customizing the template.
- `EXPECTED_STATUS_OPTIONS` constant — codifies the status values MCP tools rely on (e.g. `Tasks.Done = "Done"`); doctor flags missing values that would cause silent breakage.
- `src/schema-defaults.ts` — extracted `DB_KEYS` / `DB_NAME_DEFAULTS` / `PROPERTY_DEFAULTS` from `index.ts` so doctor + server share one source of truth.

### Changed
- `--help` documents the new `doctor` subcommand.

## [1.5.0] — 2026-04-19

### Added
- **Interactive setup CLI** — `npx -y @dkatsiros/notion-brain setup` walks non-developers through Notion API key validation, integration check, client selection (Claude Desktop / Claude Code project / Cursor / Gemini CLI), and config writing. No manual JSON editing.
- `--help` and `--version` subcommands.
- `src/setup.ts` and `src/config-paths.ts` with cross-platform config locations (macOS / Windows / Linux).
- Smoke tests for `--help` and `--version` exit codes + output.

### Changed
- Binary now routes by `process.argv[2]` at module top — `setup` / `--help` / `--version` short-circuit before MCP startup; default (no args) still starts MCP stdio server.
- README leads with the new "Quick install" section; manual instructions kept below for power users.

### Safety
- Setup writes a `.bak` of any existing config file before merging, refuses to overwrite malformed JSON.
- API key input is masked; key is never logged or stored anywhere except the chosen config file(s).

## [1.4.1] — 2026-04-19

### Fixed
- **Tag pollution prevention** — `create_note`, `update_note`, `create_task`, `update_task` now inject the user's existing tag list into the tool description, instructing the LLM to reuse existing tags instead of inventing new ones.
- Declared `@tryfabric/martian` as a proper dependency (was previously bundled but not declared, breaking npm installs).

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
