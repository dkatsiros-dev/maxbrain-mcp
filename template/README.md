# Max Brain Notion Template

The Notion-side companion to [`@dkatsiros/notion-brain`](https://www.npmjs.com/package/@dkatsiros/notion-brain).

## Get the template

**Public duplicable link:** https://prickly-organ-72f.notion.site/Ultimate-Brain-268e2c2e9b6b80dea529d8654270db2a

> ⚠️ The template is in the process of being renamed from "Ultimate Brain" → "Max Brain". The MCP server defaults to `ROOT_PAGE_NAME=Max Brain`. If you duplicate before the rename completes, set `ROOT_PAGE_NAME=Ultimate Brain` in your MCP config.

## What's in it

A PARA-method second brain with five core databases:

| Database | Purpose |
|---|---|
| **Projects** | Things you're actively working toward, with a deadline |
| **Tasks** | Atomic actionable items, linked to projects |
| **Notes** | Reference notes, linked to projects/areas, optionally tagged |
| **Areas/Resources** | Areas of responsibility (ongoing) + reference resources |
| **Goals** | Higher-level objectives that group projects |

Plus:
- **Milestones** — checkpoints under goals
- **Habit tracker** — daily checkboxes/numeric metrics

## Setup

1. **Click "Duplicate"** on the template link above (top-right in Notion)
2. **Verify the root page is titled** `Max Brain` (or note your custom title for the env var)
3. **Connect a Notion integration** — see [main README](../README.md#part-1--notion-shared)
4. **Install the MCP** in your LLM client — see [main README](../README.md#part-2--connect-your-llm-client)

Once configured, ask your LLM:
- "What are my active projects?"
- "Create a task: review Q3 plan, due Friday, High priority, in project Work"
- "Give me my daily summary"

## Database schemas

For the exact property names, types, and valid status options the MCP server expects, see [`structure-spec.md`](./structure-spec.md).

The MCP server **auto-discovers** databases from the template structure on startup. If you rename properties in your duplicated copy, the server warns you and you can override via `PROP_*` env vars (see [main README](../README.md#configuration)).

## Roadmap

- **v2: programmatic provisioning** — `notion-brain init` CLI to scaffold the entire template structure in any Notion workspace via API. No template duplication needed.
- **Premium template variants** (TBD): richer dashboards, finance tracking, CRM module
