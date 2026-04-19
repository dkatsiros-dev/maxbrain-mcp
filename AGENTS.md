# Agent Runbook — @dkatsiros/notion-brain

This file is the operational playbook for any AI agent working on the MCP server. Read this first.

## What this repo is

An npm package + git repo: a TypeScript MCP server that auto-discovers a Notion "Max Brain" PARA template and exposes 10+ tools to LLMs. Single-file server (`src/index.ts`, ~1100 lines), built with tsup to a single ESM bundle.

- **Git repo:** https://github.com/dkatsiros-dev/maxbrain-mcp
- **npm package:** https://www.npmjs.com/package/@dkatsiros/notion-brain (public, MIT)
- **Owner:** dkatsiros (personal npm account; repo under `dkatsiros-dev` GitHub org)

## Golden rules

1. **Never commit secrets.** `.env`, `.mcp.json` at project root, and any `secret_*` / `ntn_*` / `github_pat_*` value must never land in git. Check `git diff` before every commit.
2. **The npm package ships only three files:** `dist/index.js`, `README.md`, `package.json`, + `LICENSE`. If you add source files, update `files` in `package.json` and re-run `npm pack --dry-run` to verify.
3. **Source maps are excluded from npm.** `package.json` `files` uses `dist/**/*.js` — do not switch to `"dist"` (would leak source).
4. **Keep the server client-agnostic.** Descriptions and error messages should say "your LLM" / "your client", not "Claude Code" specifically. The Claude-specific auto-approve block lives only in the Claude Code section of the README.
5. **Trademark safety:** the product name is **Max Brain**. Never use a different name in code, docs, descriptions, or commits — it would create trademark exposure with a competing template product.

## Pre-change checklist

Before editing tool behavior, schema handling, or auto-discovery:

1. Read `src/index.ts` sections involved (file is single-source-of-truth).
2. Run `npm test` — baseline should be green.
3. If touching tool I/O, also run a live e2e:
   ```bash
   NOTION_API_KEY="$(grep NOTION_API_KEY ../.mcp.json | sed -E 's/.*"(ntn_[^"]+)".*/\1/')" \
   ROOT_PAGE_NAME="Max Brain" \
   node dist/index.js &
   # Ctrl-C after seeing "running on stdio"
   ```
   Or just call an MCP tool in the connected Claude Code session (the loaded server is the local `dist/index.js`).

## Build / test / publish flow

```bash
npm install
npm run build           # tsup → dist/index.js + sourcemap
npm run typecheck       # tsc --noEmit
npm test                # vitest smoke suite (4 tests, ~2s)
npm pack --dry-run      # verify payload is 3 files
```

### Release

1. Bump `version` in `package.json` (semver: bug → patch, tool/field additions → minor, breaking schema → major).
2. Update `CHANGELOG.md` with what changed.
3. Commit: `git commit -m "vX.Y.Z: <summary>"`.
4. Push to `main`.
5. User runs (publish requires Touch ID passkey, can't be done by agent):
   ```bash
   npm publish --access public --auth-type=web
   ```
6. Verify: `npm view @dkatsiros/notion-brain version`.

## Orchestration pattern — when making non-trivial changes

**The agent acts as orchestrator, not doer.** Think in phases:

1. **Understand** — read relevant sections of `src/index.ts` + any plan file.
2. **Plan** — in plan mode for anything beyond trivial. List files + exact edits.
3. **Implement** — edits only. Never `git commit` or `npm publish` without explicit user ask.
4. **Verify** — `npm run build && npm run typecheck && npm test`. For tool changes, also call the live MCP tool or spawn the binary.
5. **Document** — add CHANGELOG entry + README update if user-facing.
6. **Ship** — commit with terse message, push. User runs `npm publish`.

## Known quirks

- **Module-level side effects in `src/index.ts`:** env check + notion client init happen at import time. This makes pure-unit testing hard; tests spawn the binary instead.
- **Auto-discovery is recursive** through `column_list` / `column` / `toggle` layout blocks — don't "simplify" the `flattenBlocks()` walker or you'll miss databases nested in columns.
- **`Done`, `Priority`, `Status` are `status` properties, NOT checkbox/select.** Use `getStatus()` and `status: { equals: "..." }` filters. Mixing types will silently return wrong results.
- **Property name resolution:** always use `prop('tasks', 'Done')`, never hardcode property names — users can rename via `PROP_*` env vars.
- **DB ID resolution:** always use `dbId('tasks')`, not env vars directly — auto-discovery overrides env.
- **Gemini web (gemini.google.com) does NOT support MCP.** Only Gemini CLI. If a user asks about Gemini web integration, redirect to CLI or another MCP client.

## Files & their purpose

| Path | Purpose |
|---|---|
| `src/index.ts` | Entire server — tools, schema, auto-discovery, handlers |
| `dist/index.js` | Built bundle (shipped to npm; built by `tsup`) |
| `test/smoke.test.ts` | Vitest smoke suite — spawns binary with different envs |
| `package.json` | npm manifest — `files`, `bin`, deps, scripts |
| `tsup.config.ts` | Build config — ESM, node18, shebang banner |
| `.env.example` | Documents all supported env vars |
| `CHANGELOG.md` | Semver release notes |
| `AGENTS.md` | **This file** |
| `README.md` | User-facing docs — install, setup per client, tools, troubleshooting |
| `LICENSE` | MIT |
| `src/setup.ts` | Interactive setup CLI (`notion-brain setup`) |
| `src/doctor.ts` | Health check — CLI + `health_check` MCP tool (single source of truth) |
| `src/schema-defaults.ts` | `DB_KEYS`, `PROPERTY_DEFAULTS`, `EXPECTED_STATUS_OPTIONS`, `normalizeOption()` |
| `src/config-paths.ts` | Cross-platform MCP-client config paths |
| `template/README.md` + `template/structure-spec.md` | Public template docs |

## Secrets handling

- The `NOTION_API_KEY` for the owner's workspace lives in `../.mcp.json` (project root, gitignored). Agents can read it from there for live e2e. Never echo it into commits, PR descriptions, or user-facing output.
- If a user pastes a token into chat, tell them to rotate it immediately and never stage it.

## Current state (2026-04-19)

- **v1.6.2 published.** 14 MCP tools. Setup CLI + doctor CLI + `health_check` MCP tool. Markdown rendering. Fuzzy status-option matching. Tag pollution prevention.
- **Public template launch-ready** — branded, scrubbed, doctor-green at https://dkatsiros.notion.site/Max-Brain-9977fa4ee5e683768e3b816d8fd81466
- **v1.4.0 deprecated** on npm (missing `@tryfabric/martian` dep).

## Open backlog (next phases)

- **Marketing**: demo GIF, Show HN draft, X/Reddit posts
- **v1.7+ tools**: `archive_project(cascade)`, `add_subtask`, `block_task`/`unblock_task`, `get_milestones`, `get_fleeting_notes`, AI-native fields (`AI Summary` / `Last AI Access` / `Needs Processing`)
- **v2 `notion-brain init`**: programmatic template provisioning (caveat: API can't create views; position as power-user install)
- **Template schema cleanup**: delete 10 dead formulas (per `cto-review-automations.md`); add Age/Days-Since-Last-Edit formulas; fix `Task Completion %` rollup
- **Strategic decisions queued**: Habit tracker normalization, split Areas/Resources, AI-Summary write timing
- **Openclaw** autonomous helper — separate track, see `../openclaw-design.md`

See `../todos.md` for the full product-level backlog.
