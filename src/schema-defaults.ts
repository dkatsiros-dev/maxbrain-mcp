// Canonical schema expectations for the Max Brain template.
// Used by:
//   - The MCP server (src/index.ts) for property resolution + startup validation warnings
//   - The doctor command (src/doctor.ts) for health checks
// Keep in sync with template/structure-spec.md.

export type DbKey = 'projects' | 'tasks' | 'notes' | 'areas' | 'goals';

export const DB_KEYS: DbKey[] = ['projects', 'tasks', 'notes', 'areas', 'goals'];

export const DB_NAME_DEFAULTS: Record<DbKey, string> = {
  projects: 'Projects',
  tasks: 'Tasks',
  notes: 'Notes',
  areas: 'Areas/Resources',
  goals: 'Goals',
};

export const PROPERTY_DEFAULTS: Record<DbKey, Record<string, string>> = {
  tasks: {
    Done: 'status',
    Priority: 'status',
    Due: 'date',
    Project: 'relation',
    Tags: 'multi_select',
    Assignee: 'select',
    Description: 'rich_text',
    Difficulty: 'select',
    Snooze: 'date',
    'Blocked by': 'relation',
  },
  projects: {
    Status: 'status',
    Area: 'relation',
    Archive: 'checkbox',
    Priority: 'checkbox',
    'Target Deadline': 'date',
    Goals: 'relation',
  },
  notes: {
    Project: 'relation',
    'Area/Resource': 'relation',
    Tags: 'multi_select',
    Favorite: 'checkbox',
    Archive: 'checkbox',
    'Remind Me Date': 'date',
    Fleeting: 'checkbox',
    URL: 'url',
  },
  areas: {
    Type: 'status',
    Projects: 'relation',
    Notes: 'relation',
    Archive: 'checkbox',
  },
  goals: {
    Status: 'status',
    'Target Deadline': 'date',
    'Goal Set': 'date',
    Achieved: 'date',
    Projects: 'relation',
    Area: 'relation',
    Tags: 'multi_select',
    Archive: 'checkbox',
  },
};

// Strip emoji, punctuation, and whitespace for fuzzy comparison of status option names.
// Lets us match "Low" against template values like "🧀 Low" or " low ".
export function normalizeOption(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Component}]/gu, '')
    .replace(/[^a-z0-9]/g, '');
}

// Status-property option values that the MCP relies on. Missing options here
// cause silent breakage (e.g. complete_task hardcodes "Done"). Doctor flags these.
// Goals.Status is intentionally NOT listed — users commonly customize goal lifecycles.
export const EXPECTED_STATUS_OPTIONS: Record<DbKey, Record<string, string[]>> = {
  projects: {
    Status: ['To Do', 'Doing', 'Ongoing', 'On Hold', 'Done', 'Aborted'],
  },
  tasks: {
    Done: ['Not started', 'In progress', 'Done', 'Aborted'],
    Priority: ['Low', 'Medium', 'High'],
  },
  areas: {
    Type: ['Area', 'Resource'],
  },
  notes: {},
  goals: {},
};
