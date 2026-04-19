# Max Brain Template — Schema Specification

This is the canonical schema the MCP server expects. The auto-discovery layer locates databases by title under a root page (default: `Max Brain` → `Databases`). If your duplicated template uses different property names, set `PROP_*` env var overrides.

> Source of truth: `mcp-server/src/index.ts` — `PROPERTY_DEFAULTS` constant.

## Page hierarchy (required)

```
Max Brain                       (root page, configurable: ROOT_PAGE_NAME)
└── Databases                   (sub-page, configurable: DATABASES_PAGE_NAME)
    ├── Projects                (database)
    ├── Tasks                   (database)
    ├── Notes                   (database)
    ├── Areas/Resources         (database)
    └── Goals                   (database)
```

The MCP server walks `Max Brain → Databases → [child_database]` recursively (handles `column_list` / `column` / `toggle` blocks). Database titles must match exactly (case-insensitive).

Optional, used by future tools:
- `Milestones` (database, under Databases or Goals)
- `Habit tracker` (database, under any sub-page like `Self-Care`)

## Required properties per database

### Projects

| Property | Type | Notes |
|---|---|---|
| `Name` | title | — |
| `Status` | status | Options expected: `To Do`, `Doing`, `Ongoing`, `On Hold`, `Done`, `Aborted` |
| `Area` | relation → Areas/Resources | — |
| `Archive` | checkbox | Excluded from default queries |
| `Priority` | checkbox | — |
| `Target Deadline` | date | — |
| `Goals` | relation → Goals | — |

### Tasks

| Property | Type | Notes |
|---|---|---|
| `Name` | title | — |
| `Done` | status | Options expected: `Not started`, `In progress`, `Done`, `Aborted` |
| `Priority` | status | Options expected: `Low`, `Medium`, `High` |
| `Due` | date | — |
| `Project` | relation → Projects | — |
| `Tags` | multi_select | — |
| `Assignee` | select | — |
| `Description` | rich_text | Markdown supported via MCP |
| `Difficulty` | select | Optional |
| `Snooze` | date | Used by `snooze_task` tool |
| `Blocked by` | relation → Tasks | Used by `get_blocked_tasks` |

### Notes

| Property | Type | Notes |
|---|---|---|
| `Name` | title | — |
| `Project` | relation → Projects | Canonical project link |
| `Area/Resource` | relation → Areas/Resources | — |
| `Tags` | multi_select | LLM is told to reuse existing |
| `Favorite` | checkbox | — |
| `Archive` | checkbox | Excluded from default queries |
| `Remind Me Date` | date | Used by `get_reminders` |
| `Fleeting` | checkbox | Inbox/processing flag |
| `URL` | url | — |

### Areas/Resources

| Property | Type | Notes |
|---|---|---|
| `Name` | title | — |
| `Type` | status | Options: `Area`, `Resource` |
| `Projects` | relation → Projects | — |
| `Notes` | relation → Notes | — |
| `Archive` | checkbox | — |

### Goals

| Property | Type | Notes |
|---|---|---|
| `Name` | title | — |
| `Status` | status | — |
| `Target Deadline` | date | — |
| `Goal Set` | date | — |
| `Achieved` | date | — |
| `Projects` | relation → Projects | — |
| `Area` | relation → Areas/Resources | — |
| `Tags` | multi_select | — |
| `Archive` | checkbox | — |

## Property name overrides

If your template renames a property, set the matching env var in your MCP config:

```
PROP_TASKS_DUE=Deadline
PROP_NOTES_AREA_RESOURCE=Area
```

Format: `PROP_{DBNAME}_{PROPERTY}` — uppercase, non-alphanumeric chars become underscores.

## Status option overrides

The MCP **does not yet validate** that status options match expected values (planned for v1.5). If you've renamed `"Done"` to `"Completed"`, the `complete_task` tool will fail with a Notion API validation error. For now, keep status option names as listed above.

## Notes on the live owner template

The owner's personal Notion (which seeded the public template) has many additional formula/rollup properties for UI views — these are **not** required by the MCP and will be cleaned up in the published template. See `cto-review-automations.md` (in the product docs) for the cleanup list.
