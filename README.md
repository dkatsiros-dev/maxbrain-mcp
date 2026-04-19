# Max Brain MCP Server

[![npm version](https://img.shields.io/npm/v/@dkatsiros/notion-brain.svg)](https://www.npmjs.com/package/@dkatsiros/notion-brain)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

Connect your LLM — **Claude Code**, **Gemini CLI**, **Cursor**, or any MCP-compatible client — to your Notion second brain (PARA method). Manage Projects, Tasks, Notes, Goals, and Areas through natural conversation.

## What It Does

- **Search** across all your Notion databases at once
- **Get & create projects** — filter by status, exclude archived, "active" shorthand
- **Get & create tasks** — filter by project, completion, priority, due dates
- **Complete tasks** — mark them done from the chat
- **Get & create notes** — filter by project, area, or tags
- **Get goals** — list high-level objectives linked to projects
- **Daily summary** — overdue tasks, upcoming 7 days, recent notes (3 days)
- **Auto-discovery** — finds your databases automatically from your Notion page structure
- **Dynamic schema** — reads your actual property names and valid values on startup
- **Flexible status matching** — your LLM maps "in progress", "wip", "active" to the right values

## Prerequisites

- Node.js 18+ (`node --version`)
- An MCP-compatible client (Claude Code, Gemini CLI, Cursor, Cline, Continue, Claude Desktop, …)
- A Notion account with the Max Brain template installed
- A Notion integration (API key) with access to the template

---

## Quick install (recommended)

One command:

```bash
npx -y @dkatsiros/notion-brain setup
```

The interactive setup walks you through:
1. Pasting your Notion API key
2. Verifying the integration is connected to your Max Brain page
3. Picking which LLM client(s) to configure (Claude Desktop / Claude Code / Cursor / Gemini CLI)
4. Writing the right config to the right file — no manual JSON editing

Before running, make sure you've duplicated the template into your Notion (see Part 0 below) and created a Notion integration with access to it.

---

## Setup (manual, step-by-step)

If you'd rather configure things by hand, follow these three parts.

### Part 0 — Duplicate the Notion template

**Public template:** https://dkatsiros.notion.site/Max-Brain-9977fa4ee5e683768e3b816d8fd81466

Click **"Duplicate"** (top-right) to clone it into your own Notion workspace. See [`template/README.md`](./template/README.md) for what's inside and [`template/structure-spec.md`](./template/structure-spec.md) for the exact schema.

> **Coming soon (v2):** `notion-brain init` CLI to scaffold the template programmatically — no duplication required.

### Part 1 — Notion API setup (shared)

#### 1.1 Get Your Notion API Key

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **"+ New integration"**
3. Name it "Max Brain" or similar
4. Copy the **Internal Integration Secret** (starts with `secret_` or `ntn_`)

#### 1.2 Connect the Integration to Your Template

In Notion, open your Max Brain top-level page:
1. Click **"..."** menu → **"Connections"** → add your integration
2. When prompted, grant access — this covers all sub-pages and databases

---

### Part 2 — Connect Your LLM Client

Pick the section matching your client. The config shape is the same everywhere — only the settings-file location differs.

#### Option A — Claude Code

Add to your `.mcp.json` (project-level) or `~/.claude/claude_desktop_config.json` (global):

```json
{
  "mcpServers": {
    "notion-brain": {
      "command": "npx",
      "args": ["-y", "@dkatsiros/notion-brain"],
      "env": {
        "NOTION_API_KEY": "secret_your_key_here"
      }
    }
  }
}
```

**Auto-approve permissions (recommended)** — avoid a prompt every time a tool runs. Add to `.claude/settings.json` (project) or `~/.claude/settings.json` (global):

```json
{
  "permissions": {
    "allow": [
      "mcp__notion-brain__*"
    ]
  }
}
```

Restart Claude Code. You should see `notion-brain` tools available.

---

#### Option B — Gemini CLI

Requires a Gemini Pro / Google account.

1. Install & authenticate:
   ```bash
   npm install -g @google/gemini-cli
   gemini          # runs auth flow on first launch
   ```
2. Edit `~/.gemini/settings.json` (create if missing):
   ```json
   {
     "mcpServers": {
       "notion-brain": {
         "command": "npx",
         "args": ["-y", "@dkatsiros/notion-brain"],
         "env": {
           "NOTION_API_KEY": "secret_your_key_here"
         }
       }
     }
   }
   ```
3. Run `gemini`, then inside the REPL type `/mcp` — you should see `notion-brain` with 10 tools.

> **Note:** Gemini **web** (gemini.google.com) does NOT support MCP. CLI only.

---

#### Option C — Other MCP Clients

Same config shape, different settings-file paths:

| Client | Settings file |
|---|---|
| Cursor | `~/.cursor/mcp.json` |
| Cline (VS Code) | Cline extension settings → MCP Servers |
| Continue | `~/.continue/config.json` (under `mcpServers`) |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |

Drop the same `mcpServers.notion-brain` block from Option A into the chosen file. Restart the client.

---

## Usage Examples

Talk to your LLM naturally:

```
"Show me all my active projects"
"What tasks are due this week?"
"Create a task: Review Q2 OKRs, due Friday, High priority"
"Mark task [id] as done"
"Save a note titled 'Meeting notes' in the Sporty project"
"Give me my daily summary"
"Search for everything related to marketing"
"What are my goals?"
"List notes tagged 'idea'"
```

## Available Tools

| Tool | Description |
|------|-------------|
| `search` | Full-text search across all databases |
| `get_projects` | List projects, filter by status. Supports "active" shorthand |
| `create_project` | Create a new project with status and area |
| `update_project` | Update project fields (name, status, area, archive) |
| `get_tasks` | List tasks, filter by project, completion, or status |
| `create_task` | Create a task with due date, priority, project link, tags |
| `update_task` | Update task fields (title, status, priority, due, project, tags, assignee) |
| `complete_task` | Mark a task as done |
| `snooze_task` | Defer a task until a given date (sets Snooze) |
| `get_blocked_tasks` | List tasks with a non-empty Blocked by relation |
| `get_reminders` | List notes with a Remind Me Date (defaults to today/past) |
| `get_notes` | List notes, filter by project, area, or tag |
| `create_note` | Create a note with project/area link and tags |
| `update_note` | Update note fields (title, content, project, area, tags, favorite, archive) |
| `get_goals` | List goals, filter by status, exclude archived |
| `get_daily_summary` | Overdue + upcoming tasks + recent notes |

## How Auto-Discovery Works

On startup, the server:
1. Searches for your root page (default: "Max Brain", configurable via `ROOT_PAGE_NAME`)
2. Finds the "Databases" sub-page within the template structure
3. Matches databases by title: Projects, Tasks, Notes, Areas/Resources, Goals
4. Fetches each database's schema to validate properties and extract valid status values
5. Generates a dynamic description so your LLM always knows the real property names

If auto-discovery fails (e.g., different template structure), set database IDs manually:

```json
{
  "env": {
    "NOTION_API_KEY": "secret_...",
    "PROJECTS_DB_ID": "your_id",
    "TASKS_DB_ID": "your_id",
    "NOTES_DB_ID": "your_id",
    "AREAS_DB_ID": "your_id",
    "GOALS_DB_ID": "your_id"
  }
}
```

## Configuration

All env vars except `NOTION_API_KEY` are optional:

| Env Var | Default | Description |
|---------|---------|-------------|
| `NOTION_API_KEY` | (required) | Notion integration secret |
| `ROOT_PAGE_NAME` | `Max Brain` | Top-level page title to search for |
| `DATABASES_PAGE_NAME` | `Databases` | Sub-page containing the databases |
| `MAX_BRAIN_PAGE_ID` | (auto) | Skip search, use this page ID directly |
| `*_DB_ID` | (auto) | Override auto-discovered database IDs |
| `PROP_*` | (auto) | Override property names (e.g. `PROP_TASKS_DUE=Deadline`) |

## Troubleshooting

**Server takes a few seconds to start**
- Normal — auto-discovery makes ~8 API calls on startup (search + schema fetch)

**"Could not find root page" error**
- Make sure the Notion integration is connected to your root page
- Check `ROOT_PAGE_NAME` matches your page title exactly
- Set `MAX_BRAIN_PAGE_ID` to skip search

**"Could not discover database" error**
- The database title may not match expected names
- Set individual `*_DB_ID` env vars as fallback

**"Unauthorized" error**
- Check your `NOTION_API_KEY` starts with `secret_` or `ntn_`
- Regenerate at https://www.notion.so/my-integrations

**Tools not showing in your client**
- Restart the client after adding MCP config
- Validate JSON syntax in the settings file (no trailing commas)
- Check the client's MCP logs / stderr for startup errors
- Server may still be connecting (auto-discovery takes a few seconds)
- Claude Code: run `/mcp` to list loaded servers; Gemini CLI: same command

**Property mismatch warnings on startup**
- The server validates properties against expected defaults
- If you renamed properties in Notion, set `PROP_*` env var overrides

## Install from npm

Published: [`@dkatsiros/notion-brain`](https://www.npmjs.com/package/@dkatsiros/notion-brain) on npm (public).

The config snippets above use `npx -y @dkatsiros/notion-brain`, which downloads and runs the latest version on demand — no manual install required.

If you prefer a global install:
```bash
npm install -g @dkatsiros/notion-brain
```
Then replace `"command": "npx"` and `"args": ["-y", "@dkatsiros/notion-brain"]` with:
```json
"command": "notion-brain",
"args": []
```

## Development

```bash
git clone https://github.com/dkatsiros-dev/maxbrain-mcp.git
cd maxbrain-mcp
npm install
npm run build
npm run typecheck
npm test          # smoke tests
npm run dev       # watch mode
```

### Publishing

```bash
npm run build
npm pack --dry-run   # verify payload: only dist/index.js + README + package.json
npm publish --access public --auth-type=web
```

## License

MIT
