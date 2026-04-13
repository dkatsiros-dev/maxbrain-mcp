# Changelog

All notable changes to `@dkatsiros/notion-brain` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

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
