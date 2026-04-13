# Schema Audit — Live Template vs `PROPERTY_DEFAULTS`

**Date:** 2026-04-13
**Tested against:** Dimitris's personal workspace ("Ultimate Brain" root)

## Result

✅ **All expected properties present.** No missing properties, no type mismatches. `PROPERTY_DEFAULTS` in `src/index.ts:79` is in sync with the shipped template.

## Extra properties in live template

These are present in the owner's template but NOT in `PROPERTY_DEFAULTS`. Many are automation (formulas, rollups, `Created time`, `Last edited time`) — no action needed. Below is the subset of **editable / potentially-useful** extras that could drive future tool additions.

### Tasks
- `Snooze` (date) — defer date (could power a `snooze_task` tool)
- `Blocked by` / `Blocking` (relation → Tasks) — dependency graph
- `Parent item` / `Sub-item` (relation → Tasks) — hierarchical subtasks
- `For Max` (checkbox) — delegation flag to Max (the collaborator)
- `Max Model` (select) — model used when task handled by Max
- `Max Notes` (rich_text) — Max's note on the task
- `Pulled Notes` (relation → Notes)
- `State` (rich_text)

### Projects
- `Tasks` (relation → Tasks) — reverse view
- `Notes` (relation → Notes) — reverse view
- `Machines` (multi_select)
- `Pulled Resources` (relation)

### Notes
- `URL` (url) — bookmark-style link
- `Remind Me Date` (date) — scheduled reminder
- `Fleeting` (checkbox) — fleeting-vs-permanent classification (Zettelkasten)
- `Related Notes` (relation → Notes)
- `Comments` (rich_text)

### Areas/Resources
- `Resources` (relation) — Areas ⇄ Resources link
- `Root Area` (relation) — hierarchical Areas
- `Goal` (relation → Goals)

### Goals
- `Milestones` (relation → Milestones DB) — Milestones DB exists outside the 5 core but is reachable here

## Recommendations

Future tool backlog items unlocked by these extras (not in current v1.1.0):

- `snooze_task(task_id, until: date)` — set Tasks.Snooze
- `block_task(task_id, blocked_by_id)` / `unblock_task(task_id)` — manage Tasks.Blocked by
- `add_subtask(parent_id, …)` — use Tasks.Parent item
- `create_note(url, fleeting: bool, remind_me: date)` — extend existing `create_note`
- `get_reminders()` — Notes with `Remind Me Date` ≤ today
- `get_fleeting_notes()` — Notes where Fleeting=true (prompt to review/promote)
- `get_blocked_tasks()` — tasks with non-empty Blocked by
- `get_milestones(goal_id)` — requires discovering/adding Milestones DB to auto-discovery

## Action

None required for v1.1.0. These are v1.2+ candidates. Log kept here for traceability.
