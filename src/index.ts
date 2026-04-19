import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@notionhq/client';
import { markdownToBlocks, markdownToRichText } from '@tryfabric/martian';
import { z } from 'zod';
import type {
  PageObjectResponse,
  PartialPageObjectResponse,
  DatabaseObjectResponse,
  PartialDatabaseObjectResponse,
  QueryDatabaseResponse,
  BlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints.js';

// ---------------------------------------------------------------------------
// Subcommand routing — must run before any module-level state init
// ---------------------------------------------------------------------------

const VERSION = '1.6.1';
const subcommand = process.argv[2];

if (subcommand === 'setup') {
  const { run } = await import('./setup.js');
  await run();
  process.exit(process.exitCode ?? 0);
}

if (subcommand === 'doctor') {
  const { run } = await import('./doctor.js');
  await run();
  process.exit(process.exitCode ?? 0);
}

if (subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
  process.stdout.write(`@dkatsiros/notion-brain — Notion PARA second brain MCP server

Usage:
  notion-brain                Start MCP server (stdio mode, default)
  notion-brain setup          Interactive setup — Notion API key + LLM client config
  notion-brain doctor         Health check — verify your template matches the expected schema
  notion-brain --help         Show this help
  notion-brain --version      Show version

The default mode (no args) speaks the MCP stdio protocol. Configure it in your
LLM client (Claude Desktop, Claude Code, Cursor, Gemini CLI) — or run \`setup\`
to do that automatically. Run \`doctor\` if MCP tools start failing, or after
you customize properties in your Notion template.

Docs:    https://github.com/dkatsiros-dev/maxbrain-mcp
npm:     https://www.npmjs.com/package/@dkatsiros/notion-brain
Template: https://dkatsiros.notion.site/Max-Brain-9977fa4ee5e683768e3b816d8fd81466
`);
  process.exit(0);
}

if (subcommand === '--version' || subcommand === '-v') {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getEnvOrThrow(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`Error: Missing required environment variable: ${name}\n`);
    process.exit(1);
  }
  return value;
}

const NOTION_API_KEY = getEnvOrThrow('NOTION_API_KEY');

// DB IDs: optional — auto-discovered from root page structure
const ENV_DB_IDS: Partial<Record<DbKey, string>> = {
  projects: process.env['PROJECTS_DB_ID'] || undefined,
  tasks: process.env['TASKS_DB_ID'] || undefined,
  notes: process.env['NOTES_DB_ID'] || undefined,
  areas: process.env['AREAS_DB_ID'] || undefined,
  goals: process.env['GOALS_DB_ID'] || undefined,
};

const ROOT_PAGE_NAME = process.env['ROOT_PAGE_NAME'] || 'Max Brain';
const DATABASES_PAGE_NAME = process.env['DATABASES_PAGE_NAME'] || 'Databases';

const notion = new Client({ auth: NOTION_API_KEY });

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

import type { DbKey } from './schema-defaults.js';

interface PropertyInfo {
  name: string;
  type: string;
  options?: string[];
}

interface DbSchema {
  id: string;
  title: string;
  properties: Record<string, PropertyInfo>;
  allProperties: PropertyInfo[];
}

type BrainSchema = Record<DbKey, DbSchema>;

// Module-level schema — initialized in main() before tools are registered
let schema: BrainSchema;

// ---------------------------------------------------------------------------
// Hardcoded defaults (match the shipped template) — see src/schema-defaults.ts
// ---------------------------------------------------------------------------

import { DB_NAME_DEFAULTS, PROPERTY_DEFAULTS } from './schema-defaults.js';

// ---------------------------------------------------------------------------
// Property name override via env vars
// ---------------------------------------------------------------------------

function getPropertyOverride(dbKey: string, propKey: string): string | undefined {
  const envKey = `PROP_${dbKey.toUpperCase()}_${propKey.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
  return process.env[envKey] || undefined;
}

// ---------------------------------------------------------------------------
// Schema helpers — shorthand for accessing property names
// ---------------------------------------------------------------------------

function prop(dbKey: DbKey, logicalName: string): string {
  return schema[dbKey].properties[logicalName]?.name ?? logicalName;
}

function dbId(dbKey: DbKey): string {
  return schema[dbKey].id;
}

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

type AnyPage = PageObjectResponse | PartialPageObjectResponse | DatabaseObjectResponse | PartialDatabaseObjectResponse;

function isFullPage(page: AnyPage): page is PageObjectResponse {
  return 'properties' in page && 'created_time' in page;
}

type NotionFilter = NonNullable<Parameters<typeof notion.databases.query>[0]['filter']>;

// ---------------------------------------------------------------------------
// Property helpers
// ---------------------------------------------------------------------------

function getTitle(page: PageObjectResponse, field = 'Name'): string {
  const p = page.properties[field];
  if (!p) return '';
  if (p.type === 'title') return p.title.map((t) => t.plain_text).join('');
  return '';
}

function getRichText(page: PageObjectResponse, field: string): string {
  const p = page.properties[field];
  if (!p) return '';
  if (p.type === 'rich_text') return p.rich_text.map((t) => t.plain_text).join('');
  return '';
}

function getSelect(page: PageObjectResponse, field: string): string {
  const p = page.properties[field];
  if (!p) return '';
  if (p.type === 'select' && p.select) return p.select.name;
  return '';
}

function getStatus(page: PageObjectResponse, field: string): string {
  const p = page.properties[field];
  if (!p) return '';
  if (p.type === 'status' && p.status) return p.status.name;
  return '';
}

function getCheckbox(page: PageObjectResponse, field: string): boolean {
  const p = page.properties[field];
  if (!p) return false;
  if (p.type === 'checkbox') return p.checkbox;
  return false;
}

function getDate(page: PageObjectResponse, field: string): string | null {
  const p = page.properties[field];
  if (!p) return null;
  if (p.type === 'date' && p.date) return p.date.start;
  return null;
}

function getRelationIds(page: PageObjectResponse, field: string): string[] {
  const p = page.properties[field];
  if (!p) return [];
  if (p.type === 'relation') return p.relation.map((r) => r.id);
  return [];
}

function getMultiSelect(page: PageObjectResponse, field: string): string[] {
  const p = page.properties[field];
  if (!p) return [];
  if (p.type === 'multi_select') return p.multi_select.map((s) => s.name);
  return [];
}

// ---------------------------------------------------------------------------
// Database query helpers
// ---------------------------------------------------------------------------

const MAX_RESULTS = 100;

async function queryDatabase(
  databaseId: string,
  filter?: Parameters<typeof notion.databases.query>[0]['filter'],
  sorts?: Parameters<typeof notion.databases.query>[0]['sorts'],
  maxResults = MAX_RESULTS,
): Promise<PageObjectResponse[]> {
  const results: PageObjectResponse[] = [];
  let cursor: string | undefined;

  while (results.length < maxResults) {
    const pageSize = Math.min(100, maxResults - results.length);
    const response: QueryDatabaseResponse = await notion.databases.query({
      database_id: databaseId,
      filter,
      sorts,
      page_size: pageSize,
      start_cursor: cursor,
    });

    for (const item of response.results) {
      if (isFullPage(item)) results.push(item);
    }

    if (!response.has_more || !response.next_cursor) break;
    cursor = response.next_cursor;
  }

  return results;
}

async function queryWithFallback(
  databaseId: string,
  filter: Parameters<typeof notion.databases.query>[0]['filter'],
  sorts?: Parameters<typeof notion.databases.query>[0]['sorts'],
  maxResults = MAX_RESULTS,
): Promise<PageObjectResponse[]> {
  try {
    return await queryDatabase(databaseId, filter, sorts, maxResults);
  } catch (err) {
    if (err instanceof Error && (err.message.includes('Could not find property') || err.message.includes('Could not find sort'))) {
      process.stderr.write(`Filter/sort failed (${err.message}), retrying without filter/sort\n`);
      return await queryDatabase(databaseId, undefined, undefined, maxResults);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

// Markdown → Notion conversion (via @tryfabric/martian).
// Use richText() for property fields (e.g. Task.Description); use blocksFromMarkdown() for page body.
// Both handle Notion's 2000-char limit and inline formatting (bold/italic/code/links/etc).

function richText(text: string): any {
  if (!text) return [{ type: 'text' as const, text: { content: '' } }];
  return markdownToRichText(text) as any;
}

function blocksFromMarkdown(text: string): any[] {
  if (!text) return [];
  return markdownToBlocks(text) as any[];
}

function formatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const msg = err.message;
  if (msg.includes('Could not find database')) return `Database not found. Check that your Notion integration has access.`;
  if (msg.includes('Invalid request URL')) return `Invalid Notion ID. Please check the database or page ID.`;
  if (msg.includes('Unauthorized') || msg.includes('API token')) return `Notion API key is invalid or expired. Check your NOTION_API_KEY.`;
  if (msg.includes('object_not_found')) return `Page or database not found. It may have been deleted or the integration lacks access.`;
  if (msg.includes('validation_error')) return `Validation error from Notion: ${msg}`;
  if (msg.includes('restricted_resource')) return `Access denied. Make sure your Notion integration is connected to this database.`;
  return `Notion API error: ${msg}`;
}

// ---------------------------------------------------------------------------
// Auto-discovery: walk "ROOT_PAGE_NAME → DATABASES_PAGE_NAME → *" structure
// ---------------------------------------------------------------------------

async function listChildBlocks(blockId: string): Promise<BlockObjectResponse[]> {
  const blocks: BlockObjectResponse[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });
    for (const block of response.results) {
      if ('type' in block) blocks.push(block as BlockObjectResponse);
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return blocks;
}

async function flattenBlocks(blockId: string): Promise<BlockObjectResponse[]> {
  const blocks = await listChildBlocks(blockId);
  const result: BlockObjectResponse[] = [];

  for (const block of blocks) {
    if (block.type === 'column_list' || block.type === 'column') {
      // Recurse into layout blocks to find actual content
      const nested = await flattenBlocks(block.id);
      result.push(...nested);
    } else {
      result.push(block);
    }
  }

  return result;
}

async function discoverDatabaseIds(): Promise<Partial<Record<DbKey, string>>> {
  const discovered: Partial<Record<DbKey, string>> = {};

  // Step 1: Find root page
  let rootPageId = process.env['MAX_BRAIN_PAGE_ID'] ?? process.env['ROOT_PAGE_ID'];

  if (!rootPageId) {
    const searchResponse = await notion.search({
      query: ROOT_PAGE_NAME,
      filter: { property: 'object', value: 'page' },
      page_size: 20,
    });

    for (const result of searchResponse.results) {
      if (isFullPage(result)) {
        const title = getTitle(result) || getTitle(result, 'title');
        if (title.toLowerCase().trim() === ROOT_PAGE_NAME.toLowerCase().trim()) {
          rootPageId = result.id;
          process.stderr.write(`Found "${ROOT_PAGE_NAME}" page: ${rootPageId}\n`);
          break;
        }
      }
    }
  }

  if (!rootPageId) {
    process.stderr.write(`WARNING: Could not find "${ROOT_PAGE_NAME}" page. Set MAX_BRAIN_PAGE_ID or individual DB ID env vars.\n`);
    return discovered;
  }

  // Step 2: Flatten root children (walks into column_list/column layout blocks)
  const rootChildren = await flattenBlocks(rootPageId);

  // Step 3: Find "Databases" sub-page
  let databasesPageId: string | undefined;
  for (const block of rootChildren) {
    if (block.type === 'child_page' && block.child_page.title.toLowerCase().trim() === DATABASES_PAGE_NAME.toLowerCase().trim()) {
      databasesPageId = block.id;
      process.stderr.write(`Found "${DATABASES_PAGE_NAME}" sub-page: ${databasesPageId}\n`);
      break;
    }
  }

  // Step 4: Get database blocks
  let dbBlocks: BlockObjectResponse[];
  if (databasesPageId) {
    dbBlocks = await listChildBlocks(databasesPageId);
  } else {
    process.stderr.write(`WARNING: "${DATABASES_PAGE_NAME}" sub-page not found, searching ${ROOT_PAGE_NAME} children directly.\n`);
    dbBlocks = rootChildren;
  }

  // Match databases by title
  const nameToKey: Record<string, DbKey> = {};
  for (const [key, name] of Object.entries(DB_NAME_DEFAULTS)) {
    nameToKey[name.toLowerCase().trim()] = key as DbKey;
  }

  for (const block of dbBlocks) {
    if (block.type === 'child_database') {
      const title = block.child_database.title.toLowerCase().trim();
      const key = nameToKey[title];
      if (key) {
        discovered[key] = block.id;
        process.stderr.write(`Auto-discovered ${key} DB: ${block.id} ("${block.child_database.title}")\n`);
      }
    }
  }

  // Report missing
  for (const key of Object.keys(DB_NAME_DEFAULTS) as DbKey[]) {
    if (!discovered[key] && !ENV_DB_IDS[key]) {
      process.stderr.write(
        `WARNING: Could not discover "${DB_NAME_DEFAULTS[key]}" database. Set ${key.toUpperCase()}_DB_ID env var.\n`,
      );
    }
  }

  return discovered;
}

// ---------------------------------------------------------------------------
// Schema building + validation
// ---------------------------------------------------------------------------

async function buildSchema(): Promise<BrainSchema> {
  // 1. Resolve DB IDs: env vars take priority over discovery
  const discovered = await discoverDatabaseIds();

  const resolvedIds = {} as Record<DbKey, string>;
  for (const key of Object.keys(DB_NAME_DEFAULTS) as DbKey[]) {
    const id = ENV_DB_IDS[key] || discovered[key];
    if (!id) {
      process.stderr.write(
        `FATAL: Cannot resolve database ID for "${DB_NAME_DEFAULTS[key]}". ` +
        `Set ${key.toUpperCase()}_DB_ID env var.\n`,
      );
      process.exit(1);
    }
    resolvedIds[key] = id;
  }

  // 2. Fetch all 5 DB schemas in parallel
  const dbKeys = Object.keys(DB_NAME_DEFAULTS) as DbKey[];
  const dbResponses = await Promise.all(
    dbKeys.map(async (key) => {
      const db = await notion.databases.retrieve({ database_id: resolvedIds[key] });
      if (!('properties' in db)) throw new Error(`Could not retrieve schema for ${key} database`);
      return { key, db: db as DatabaseObjectResponse };
    }),
  );

  // 3. Build property maps with validation
  const result = {} as Record<DbKey, DbSchema>;

  for (const { key, db } of dbResponses) {
    const defaults = PROPERTY_DEFAULTS[key];
    const properties: Record<string, PropertyInfo> = {};
    const dbTitle = db.title.map((t) => t.plain_text).join('');

    for (const [logicalName, expectedType] of Object.entries(defaults)) {
      const override = getPropertyOverride(key, logicalName);
      const actualName = override || logicalName;

      const dbProp = db.properties[actualName];
      if (!dbProp) {
        // Try case-insensitive match
        const ciMatch = Object.entries(db.properties).find(
          ([name]) => name.toLowerCase() === actualName.toLowerCase(),
        );
        if (ciMatch) {
          process.stderr.write(`INFO: ${dbTitle}.${logicalName}: using "${ciMatch[0]}" (case mismatch)\n`);
          properties[logicalName] = extractPropertyInfo(ciMatch[0], ciMatch[1]);
        } else {
          process.stderr.write(
            `WARNING: ${dbTitle} missing property "${actualName}" (expected: ${expectedType}). ` +
            `Set PROP_${key.toUpperCase()}_${logicalName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()} to override.\n`,
          );
          properties[logicalName] = { name: actualName, type: expectedType };
        }
      } else {
        if (dbProp.type !== expectedType) {
          process.stderr.write(
            `WARNING: ${dbTitle}."${actualName}" is type "${dbProp.type}", expected "${expectedType}".\n`,
          );
        }
        properties[logicalName] = extractPropertyInfo(actualName, dbProp);
      }
    }

    // Collect ALL properties for the description
    const allProperties: PropertyInfo[] = [];
    for (const [name, dbProp] of Object.entries(db.properties)) {
      allProperties.push(extractPropertyInfo(name, dbProp));
    }

    result[key] = { id: resolvedIds[key], title: dbTitle, properties, allProperties };
  }

  return result;
}

function extractPropertyInfo(
  name: string,
  dbProp: DatabaseObjectResponse['properties'][string],
): PropertyInfo {
  const info: PropertyInfo = { name, type: dbProp.type };
  if (dbProp.type === 'status') {
    info.options = (dbProp as { status: { options: { name: string }[] } }).status.options.map((o) => o.name);
  } else if (dbProp.type === 'select') {
    info.options = (dbProp as { select: { options: { name: string }[] } }).select.options.map((o) => o.name);
  } else if (dbProp.type === 'multi_select') {
    info.options = (dbProp as { multi_select: { options: { name: string }[] } }).multi_select.options.map((o) => o.name);
  }
  return info;
}

// ---------------------------------------------------------------------------
// Dynamic system description
// ---------------------------------------------------------------------------

function buildSystemDescription(s: BrainSchema): string {
  function formatProps(dbSchema: DbSchema): string {
    return dbSchema.allProperties
      .map((p) => {
        let desc = `${p.name} (${p.type})`;
        if (p.options && p.options.length > 0) desc += `: ${p.options.join(', ')}`;
        return `  - ${desc}`;
      })
      .join('\n');
  }

  return `
Notion "${ROOT_PAGE_NAME}" — PARA System MCP Server

This MCP server connects to a Notion workspace organized using the PARA method (Projects, Areas, Resources, Archives) via the "${ROOT_PAGE_NAME}" template. All knowledge and work is structured across 5 core databases that are heavily interlinked.

## Database Architecture (Live Schema)

**1. ${s.projects.title}**
${formatProps(s.projects)}

**2. ${s.areas.title}**
${formatProps(s.areas)}

**3. ${s.tasks.title}**
${formatProps(s.tasks)}

**4. ${s.notes.title}**
${formatProps(s.notes)}

**5. ${s.goals.title}**
${formatProps(s.goals)}

## Relationship Hierarchy

Goals
└── Projects (each project serves one or more goals)
    ├── Tasks (concrete action items)
    └── Notes (knowledge, research, captures)
Areas & Resources
└── Projects (each project belongs to one area)
└── Notes (area-level knowledge not tied to a specific project)

## Key Conventions

- **Active projects**: Status NOT IN (Done, Aborted) AND Archive = false.
- **Incomplete tasks**: Done status != "Done".
- **Notes for a project**: Query Notes DB filtered by Project relation.
- **Everything in an area**: Get Area page → follow Projects relation → get each project's Tasks and Notes.
- **Search**: Use Notion search API with query string — returns across all databases.
- **Page content**: Properties are in the page metadata; the actual body content (paragraphs, headings, lists) is in the page's block children.
- **Status matching**: Tools list valid status values from the live schema. When the user describes a status informally (e.g. "work in progress", "active", "wip"), map it to the closest valid value before calling the tool.
`.trim();
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

interface FormattedProject {
  id: string;
  title: string;
  status: string;
  area_ids: string[];
  archive: boolean;
  created: string;
  url: string;
}

interface FormattedTask {
  id: string;
  title: string;
  done_status: string;
  done: boolean;
  priority: string;
  due_date: string | null;
  project_ids: string[];
  description: string;
  tags: string[];
  assignee: string;
  created: string;
  url: string;
}

interface FormattedNote {
  id: string;
  title: string;
  tags: string[];
  project_ids: string[];
  area_ids: string[];
  favorite: boolean;
  created: string;
  url: string;
}

interface FormattedGoal {
  id: string;
  title: string;
  status: string;
  target_deadline: string | null;
  goal_set: string | null;
  achieved: string | null;
  project_ids: string[];
  area_ids: string[];
  tags: string[];
  archive: boolean;
  created: string;
  url: string;
}

function formatProject(page: PageObjectResponse): FormattedProject {
  return {
    id: page.id,
    title: getTitle(page) || '(untitled)',
    status: getStatus(page, prop('projects', 'Status')),
    area_ids: getRelationIds(page, prop('projects', 'Area')),
    archive: getCheckbox(page, prop('projects', 'Archive')),
    created: page.created_time,
    url: page.url,
  };
}

function formatTask(page: PageObjectResponse): FormattedTask {
  const doneField = prop('tasks', 'Done');
  const doneStatus = getStatus(page, doneField);
  return {
    id: page.id,
    title: getTitle(page) || '(untitled)',
    done_status: doneStatus || 'Not started',
    done: ['Done', 'Complete', 'Completed'].includes(doneStatus),
    priority: getStatus(page, prop('tasks', 'Priority')),
    due_date: getDate(page, prop('tasks', 'Due')),
    project_ids: getRelationIds(page, prop('tasks', 'Project')),
    description: getRichText(page, prop('tasks', 'Description')),
    tags: getMultiSelect(page, prop('tasks', 'Tags')),
    assignee: getSelect(page, prop('tasks', 'Assignee')),
    created: page.created_time,
    url: page.url,
  };
}

function formatNote(page: PageObjectResponse): FormattedNote {
  return {
    id: page.id,
    title: getTitle(page) || '(untitled)',
    tags: getMultiSelect(page, prop('notes', 'Tags')),
    project_ids: getRelationIds(page, prop('notes', 'Project')),
    area_ids: getRelationIds(page, prop('notes', 'Area/Resource')),
    favorite: getCheckbox(page, prop('notes', 'Favorite')),
    created: page.created_time,
    url: page.url,
  };
}

function formatGoal(page: PageObjectResponse): FormattedGoal {
  return {
    id: page.id,
    title: getTitle(page) || '(untitled)',
    status: getStatus(page, prop('goals', 'Status')),
    target_deadline: getDate(page, prop('goals', 'Target Deadline')),
    goal_set: getDate(page, prop('goals', 'Goal Set')),
    achieved: getDate(page, prop('goals', 'Achieved')),
    project_ids: getRelationIds(page, prop('goals', 'Projects')),
    area_ids: getRelationIds(page, prop('goals', 'Area')),
    tags: getMultiSelect(page, prop('goals', 'Tags')),
    archive: getCheckbox(page, prop('goals', 'Archive')),
    created: page.created_time,
    url: page.url,
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

function registerTools(server: McpServer) {
  // --- search ---
  server.tool(
    'search',
    'Search across all Notion databases (projects, tasks, notes, goals) for a given query string. Returns matching pages with their IDs, titles, and URLs.',
    {
      query: z.string().describe('The search query string'),
      limit: z.number().int().min(1).max(50).optional().default(20).describe('Max results (default 20, max 50)'),
    },
    async ({ query, limit = 20 }) => {
      try {
        const response = await notion.search({
          query,
          page_size: limit,
          filter: { value: 'page', property: 'object' },
        });
        const results = response.results.filter(isFullPage).map((page) => ({
          id: page.id,
          title: getTitle(page) || '(untitled)',
          url: page.url,
          created: page.created_time,
          last_edited: page.last_edited_time,
        }));
        return { content: [{ type: 'text', text: JSON.stringify({ query, count: results.length, results }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- get_projects ---
  server.tool(
    'get_projects',
    `List projects. Filter by status — valid values: ${schema.projects.properties.Status?.options?.join(', ') || 'To Do, Doing, Ongoing, On Hold, Done, Aborted'}. The user may use informal language (e.g. "in progress", "active", "wip") — map to the closest valid value. Use "active" to get all non-done, non-archived projects. Excludes archived projects by default.`,
    {
      status: z.string().optional().describe('Filter by project status. Use "active" for all non-done/non-aborted projects.'),
      include_archived: z.boolean().optional().default(false).describe('Include archived projects (default: false)'),
      limit: z.number().int().min(1).max(100).optional().default(50).describe('Max projects (default 50)'),
    },
    async ({ status, include_archived = false, limit = 50 }) => {
      try {
        const filters: NotionFilter[] = [];
        const statusProp = prop('projects', 'Status');
        const archiveProp = prop('projects', 'Archive');

        if (status === 'active') {
          filters.push(
            { property: statusProp, status: { does_not_equal: 'Done' } },
            { property: statusProp, status: { does_not_equal: 'Aborted' } },
          );
        } else if (status) {
          filters.push({ property: statusProp, status: { equals: status } });
        }

        if (!include_archived) {
          filters.push({ property: archiveProp, checkbox: { equals: false } });
        }

        let filter: NotionFilter | undefined;
        if (filters.length === 1) filter = filters[0];
        else if (filters.length > 1) filter = { and: filters } as NotionFilter;

        const pages = await queryWithFallback(dbId('projects'), filter, [{ property: 'Name', direction: 'ascending' }], limit);
        const projects = pages.map(formatProject);
        return { content: [{ type: 'text', text: JSON.stringify({ count: projects.length, projects }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- create_project ---
  server.tool(
    'create_project',
    'Create a new project. Status is a "status" property. Area is a relation ID to the Areas & Resources DB.',
    {
      name: z.string().describe('Project name/title'),
      status: z.string().optional().default('Doing').describe('Initial status (default: "Doing")'),
      area_id: z.string().optional().describe('Area/Resource page ID to link this project to'),
    },
    async ({ name, status = 'Doing', area_id }) => {
      try {
        const properties: Parameters<typeof notion.pages.create>[0]['properties'] = {
          Name: { title: [{ text: { content: name } }] },
          [prop('projects', 'Status')]: { status: { name: status } },
        };
        if (area_id) {
          properties[prop('projects', 'Area')] = { relation: [{ id: area_id }] };
        }
        const page = await notion.pages.create({ parent: { database_id: dbId('projects') }, properties });
        const fullPage = await notion.pages.retrieve({ page_id: page.id });
        if (!isFullPage(fullPage)) throw new Error('Could not retrieve created page');
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, project: formatProject(fullPage) }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- update_project ---
  server.tool(
    'update_project',
    `Update an existing project. Provide any subset of fields to change. Valid status values: ${schema.projects.properties.Status?.options?.join(', ') || 'check DB'}.`,
    {
      project_id: z.string().describe('Project page ID to update'),
      name: z.string().optional().describe('New project name/title'),
      status: z.string().optional().describe('New status'),
      area_id: z.string().optional().describe('New Area/Resource page ID (replaces existing relation)'),
      archive: z.boolean().optional().describe('Set archive flag'),
    },
    async ({ project_id, name, status, area_id, archive }) => {
      try {
        const properties: Parameters<typeof notion.pages.update>[0]['properties'] = {};
        if (name !== undefined) properties['Name'] = { title: [{ text: { content: name } }] };
        if (status !== undefined) properties[prop('projects', 'Status')] = { status: { name: status } };
        if (area_id !== undefined) properties[prop('projects', 'Area')] = { relation: [{ id: area_id }] };
        if (archive !== undefined) properties[prop('projects', 'Archive')] = { checkbox: archive };

        if (Object.keys(properties).length === 0) {
          return { content: [{ type: 'text', text: 'No fields provided to update.' }], isError: true };
        }
        await notion.pages.update({ page_id: project_id, properties });
        const fullPage = await notion.pages.retrieve({ page_id: project_id });
        if (!isFullPage(fullPage)) throw new Error('Could not retrieve updated page');
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, project: formatProject(fullPage) }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- get_tasks ---
  server.tool(
    'get_tasks',
    `List tasks. Filter by project ID or completion. Done statuses: ${schema.tasks.properties.Done?.options?.join(', ') || 'Not started, In progress, Done'}. Priority statuses: ${schema.tasks.properties.Priority?.options?.join(', ') || 'check DB'}. The user may use informal language (e.g. "in progress", "working on") — map to the closest valid value. Use "active" or "todo" for all non-done tasks.`,
    {
      project_id: z.string().optional().describe('Filter by project ID'),
      status: z.enum(['todo', 'active', 'done', 'all']).optional().default('todo').describe('"todo"/"active" (default, non-done), "done", or "all"'),
      limit: z.number().int().min(1).max(100).optional().default(50).describe('Max tasks (default 50)'),
    },
    async ({ project_id, status = 'todo', limit = 50 }) => {
      try {
        const filters: NotionFilter[] = [];
        const doneProp = prop('tasks', 'Done');
        const dueProp = prop('tasks', 'Due');

        if (status === 'todo' || status === 'active') {
          filters.push({ property: doneProp, status: { does_not_equal: 'Done' } });
        } else if (status === 'done') {
          filters.push({ property: doneProp, status: { equals: 'Done' } });
        }

        if (project_id) {
          filters.push({ property: prop('tasks', 'Project'), relation: { contains: project_id } });
        }

        let filter: NotionFilter | undefined;
        if (filters.length === 1) filter = filters[0];
        else if (filters.length > 1) filter = { and: filters } as NotionFilter;

        const pages = await queryWithFallback(
          dbId('tasks'),
          filter,
          [{ property: dueProp, direction: 'ascending' }, { property: 'Created time', direction: 'descending' }],
          limit,
        );
        const tasks = pages.map(formatTask);
        return { content: [{ type: 'text', text: JSON.stringify({ count: tasks.length, tasks }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- create_task ---
  const taskTagsList = schema.tasks.properties.Tags?.options?.join(', ') || '';
  server.tool(
    'create_task',
    'Create a new task. Due date in YYYY-MM-DD. Priority is a status property.',
    {
      title: z.string().describe('Task title'),
      description: z.string().optional().describe('Task description (Markdown supported: bold, italic, code, links — rendered as inline rich text)'),
      project_id: z.string().optional().describe('Project ID to link to'),
      due_date: z.string().optional().describe('Due date (YYYY-MM-DD)'),
      priority: z.string().optional().describe('Priority level (status property)'),
      tags: z.array(z.string()).optional().default([]).describe(`Tags (multi-select). EXISTING TAGS — strongly prefer reusing these to avoid polluting the user's tag list: ${taskTagsList || '(none yet)'}. Only invent a new tag if no existing tag fits the meaning.`),
      assignee: z.string().optional().describe('Assignee name (select)'),
    },
    async ({ title, description, project_id, due_date, priority, tags = [], assignee }) => {
      try {
        const properties: Parameters<typeof notion.pages.create>[0]['properties'] = {
          Name: { title: [{ text: { content: title } }] },
        };
        if (description) properties[prop('tasks', 'Description')] = { rich_text: richText(description) };
        if (project_id) properties[prop('tasks', 'Project')] = { relation: [{ id: project_id }] };
        if (due_date) properties[prop('tasks', 'Due')] = { date: { start: due_date } };
        if (priority) properties[prop('tasks', 'Priority')] = { status: { name: priority } };
        if (tags.length > 0) properties[prop('tasks', 'Tags')] = { multi_select: tags.map((t) => ({ name: t })) };
        if (assignee) properties[prop('tasks', 'Assignee')] = { select: { name: assignee } };

        const page = await notion.pages.create({ parent: { database_id: dbId('tasks') }, properties });
        const fullPage = await notion.pages.retrieve({ page_id: page.id });
        if (!isFullPage(fullPage)) throw new Error('Could not retrieve created page');
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, task: formatTask(fullPage) }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- update_task ---
  server.tool(
    'update_task',
    `Update an existing task. Provide any subset of fields to change. Done statuses: ${schema.tasks.properties.Done?.options?.join(', ') || 'check DB'}. Priority: ${schema.tasks.properties.Priority?.options?.join(', ') || 'check DB'}.`,
    {
      task_id: z.string().describe('Task page ID to update'),
      title: z.string().optional().describe('New task title'),
      description: z.string().optional().describe('New task description'),
      done_status: z.string().optional().describe('New Done status (e.g. "In progress", "Done")'),
      priority: z.string().optional().describe('New priority'),
      due_date: z.string().optional().describe('New due date (YYYY-MM-DD) or empty string to clear'),
      project_id: z.string().optional().describe('New project ID (replaces existing relation)'),
      tags: z.array(z.string()).optional().describe(`New tags list (replaces existing). EXISTING TAGS — strongly prefer reusing these: ${taskTagsList || '(none yet)'}. Only invent a new tag if no existing tag fits.`),
      assignee: z.string().optional().describe('New assignee'),
    },
    async ({ task_id, title, description, done_status, priority, due_date, project_id, tags, assignee }) => {
      try {
        const properties: Parameters<typeof notion.pages.update>[0]['properties'] = {};
        if (title !== undefined) properties['Name'] = { title: [{ text: { content: title } }] };
        if (description !== undefined) properties[prop('tasks', 'Description')] = { rich_text: richText(description) };
        if (done_status !== undefined) properties[prop('tasks', 'Done')] = { status: { name: done_status } };
        if (priority !== undefined) properties[prop('tasks', 'Priority')] = { status: { name: priority } };
        if (due_date !== undefined) properties[prop('tasks', 'Due')] = due_date === '' ? { date: null } : { date: { start: due_date } };
        if (project_id !== undefined) properties[prop('tasks', 'Project')] = { relation: [{ id: project_id }] };
        if (tags !== undefined) properties[prop('tasks', 'Tags')] = { multi_select: tags.map((t) => ({ name: t })) };
        if (assignee !== undefined) properties[prop('tasks', 'Assignee')] = { select: { name: assignee } };

        if (Object.keys(properties).length === 0) {
          return { content: [{ type: 'text', text: 'No fields provided to update.' }], isError: true };
        }
        await notion.pages.update({ page_id: task_id, properties });
        const fullPage = await notion.pages.retrieve({ page_id: task_id });
        if (!isFullPage(fullPage)) throw new Error('Could not retrieve updated page');
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, task: formatTask(fullPage) }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- complete_task ---
  server.tool(
    'complete_task',
    'Mark a task as done by setting Done status to "Done".',
    {
      task_id: z.string().describe('Task page ID to complete'),
    },
    async ({ task_id }) => {
      try {
        await notion.pages.update({
          page_id: task_id,
          properties: { [prop('tasks', 'Done')]: { status: { name: 'Done' } } },
        });
        const fullPage = await notion.pages.retrieve({ page_id: task_id });
        if (!isFullPage(fullPage)) throw new Error('Could not retrieve updated page');
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, task: formatTask(fullPage) }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- snooze_task ---
  server.tool(
    'snooze_task',
    'Snooze a task until a given date (sets the Snooze date property). Pass an empty string to clear the snooze.',
    {
      task_id: z.string().describe('Task page ID'),
      until: z.string().describe('Snooze until date (YYYY-MM-DD), or empty string to clear'),
    },
    async ({ task_id, until }) => {
      try {
        await notion.pages.update({
          page_id: task_id,
          properties: {
            [prop('tasks', 'Snooze')]: until === '' ? { date: null } : { date: { start: until } },
          },
        });
        const fullPage = await notion.pages.retrieve({ page_id: task_id });
        if (!isFullPage(fullPage)) throw new Error('Could not retrieve updated page');
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, task: formatTask(fullPage) }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- get_blocked_tasks ---
  server.tool(
    'get_blocked_tasks',
    'List tasks that have at least one blocker (non-empty "Blocked by" relation). Useful for reviewing what is waiting on other work.',
    {
      limit: z.number().int().min(1).max(100).optional().default(50).describe('Max tasks (default 50)'),
    },
    async ({ limit = 50 }) => {
      try {
        const blockedByProp = prop('tasks', 'Blocked by');
        const doneProp = prop('tasks', 'Done');
        const filter: NotionFilter = {
          and: [
            { property: blockedByProp, relation: { is_not_empty: true } },
            { property: doneProp, status: { does_not_equal: 'Done' } },
          ],
        };
        const pages = await queryWithFallback(
          dbId('tasks'),
          filter,
          [{ property: prop('tasks', 'Due'), direction: 'ascending' }],
          limit,
        );
        const tasks = pages.map(formatTask);
        return { content: [{ type: 'text', text: JSON.stringify({ count: tasks.length, tasks }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- get_reminders ---
  server.tool(
    'get_reminders',
    'List notes with a "Remind Me Date" set. Defaults to reminders due today or earlier. Useful for daily review.',
    {
      include_future: z.boolean().optional().default(false).describe('Include reminders with future dates (default: false — only today/past)'),
      limit: z.number().int().min(1).max(100).optional().default(50).describe('Max notes (default 50)'),
    },
    async ({ include_future = false, limit = 50 }) => {
      try {
        const remindProp = prop('notes', 'Remind Me Date');
        const today = new Date().toISOString().slice(0, 10);
        const filters: NotionFilter[] = [{ property: remindProp, date: { is_not_empty: true } }];
        if (!include_future) filters.push({ property: remindProp, date: { on_or_before: today } });
        const filter: NotionFilter = filters.length === 1 ? filters[0]! : ({ and: filters } as NotionFilter);
        const pages = await queryWithFallback(
          dbId('notes'),
          filter,
          [{ property: remindProp, direction: 'ascending' }],
          limit,
        );
        const notes = pages.map(formatNote);
        return { content: [{ type: 'text', text: JSON.stringify({ count: notes.length, notes }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- get_notes ---
  server.tool(
    'get_notes',
    'List notes. Filter by project ID, area/resource ID, or tag.',
    {
      project_id: z.string().optional().describe('Filter by project ID'),
      area_id: z.string().optional().describe('Filter by Area/Resource ID'),
      tag: z.string().optional().describe('Filter by tag name'),
      limit: z.number().int().min(1).max(100).optional().default(30).describe('Max notes (default 30)'),
    },
    async ({ project_id, area_id, tag, limit = 30 }) => {
      try {
        const filters: NotionFilter[] = [];
        if (project_id) filters.push({ property: prop('notes', 'Project'), relation: { contains: project_id } });
        if (area_id) filters.push({ property: prop('notes', 'Area/Resource'), relation: { contains: area_id } });
        if (tag) filters.push({ property: prop('notes', 'Tags'), multi_select: { contains: tag } });

        let filter: NotionFilter | undefined;
        if (filters.length === 1) filter = filters[0];
        else if (filters.length > 1) filter = { and: filters } as NotionFilter;

        const pages = await queryWithFallback(dbId('notes'), filter, [{ property: 'Created time', direction: 'descending' }], limit);
        const notes = pages.map(formatNote);
        return { content: [{ type: 'text', text: JSON.stringify({ count: notes.length, notes }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- create_note ---
  const noteTagsList = schema.notes.properties.Tags?.options?.join(', ') || '';
  server.tool(
    'create_note',
    'Create a new note. Can link to a Project and/or Area/Resource.',
    {
      title: z.string().describe('Note title'),
      content: z.string().optional().describe('Note body in Markdown — supports headings (## Heading), bullets (- item), numbered lists (1. item), bold (**bold**), italic (*italic*), code blocks (```), inline code (`code`), links ([text](url)), quotes (> quote). Rendered as proper Notion blocks.'),
      project_id: z.string().optional().describe('Project ID to link to'),
      area_id: z.string().optional().describe('Area/Resource ID to link to'),
      tags: z.array(z.string()).optional().default([]).describe(`Tags (multi-select). EXISTING TAGS — strongly prefer reusing these to keep the user's tag list clean: ${noteTagsList || '(none yet)'}. Only invent a new tag if no existing tag fits the meaning.`),
    },
    async ({ title, content, project_id, area_id, tags = [] }) => {
      try {
        const properties: Parameters<typeof notion.pages.create>[0]['properties'] = {
          Name: { title: [{ text: { content: title } }] },
        };
        if (project_id) properties[prop('notes', 'Project')] = { relation: [{ id: project_id }] };
        if (area_id) properties[prop('notes', 'Area/Resource')] = { relation: [{ id: area_id }] };
        if (tags.length > 0) properties[prop('notes', 'Tags')] = { multi_select: tags.map((t) => ({ name: t })) };

        const createParams: Parameters<typeof notion.pages.create>[0] = {
          parent: { database_id: dbId('notes') },
          properties,
        };
        if (content) {
          createParams.children = blocksFromMarkdown(content);
        }

        const page = await notion.pages.create(createParams);
        const fullPage = await notion.pages.retrieve({ page_id: page.id });
        if (!isFullPage(fullPage)) throw new Error('Could not retrieve created page');
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, note: formatNote(fullPage) }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- update_note ---
  server.tool(
    'update_note',
    'Update an existing note. Provide any subset of fields to change. To replace body content, pass new content (overwrites all existing paragraph blocks).',
    {
      note_id: z.string().describe('Note page ID to update'),
      title: z.string().optional().describe('New note title'),
      content: z.string().optional().describe('New body content in Markdown (replaces all existing blocks). Supports headings, bullets, numbered lists, bold/italic, code, links, quotes.'),
      project_id: z.string().optional().describe('New Project ID (replaces existing relation)'),
      area_id: z.string().optional().describe('New Area/Resource ID (replaces existing relation)'),
      tags: z.array(z.string()).optional().describe(`New tags list (replaces existing). EXISTING TAGS — strongly prefer reusing these: ${noteTagsList || '(none yet)'}. Only invent a new tag if no existing tag fits.`),
      favorite: z.boolean().optional().describe('Set favorite flag'),
      archive: z.boolean().optional().describe('Set archive flag'),
    },
    async ({ note_id, title, content, project_id, area_id, tags, favorite, archive }) => {
      try {
        const properties: Parameters<typeof notion.pages.update>[0]['properties'] = {};
        if (title !== undefined) properties['Name'] = { title: [{ text: { content: title } }] };
        if (project_id !== undefined) properties[prop('notes', 'Project')] = { relation: [{ id: project_id }] };
        if (area_id !== undefined) properties[prop('notes', 'Area/Resource')] = { relation: [{ id: area_id }] };
        if (tags !== undefined) properties[prop('notes', 'Tags')] = { multi_select: tags.map((t) => ({ name: t })) };
        if (favorite !== undefined) properties[prop('notes', 'Favorite')] = { checkbox: favorite };
        if (archive !== undefined) properties[prop('notes', 'Archive')] = { checkbox: archive };

        const hasPropertyUpdates = Object.keys(properties).length > 0;
        const hasContentUpdate = content !== undefined;

        if (!hasPropertyUpdates && !hasContentUpdate) {
          return { content: [{ type: 'text', text: 'No fields provided to update.' }], isError: true };
        }

        if (hasPropertyUpdates) {
          await notion.pages.update({ page_id: note_id, properties });
        }

        if (hasContentUpdate) {
          const existing = await notion.blocks.children.list({ block_id: note_id, page_size: 100 });
          for (const block of existing.results) {
            if ('id' in block) {
              await notion.blocks.delete({ block_id: block.id });
            }
          }
          if (content) {
            await notion.blocks.children.append({ block_id: note_id, children: blocksFromMarkdown(content) });
          }
        }

        const fullPage = await notion.pages.retrieve({ page_id: note_id });
        if (!isFullPage(fullPage)) throw new Error('Could not retrieve updated page');
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, note: formatNote(fullPage) }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- get_goals ---
  server.tool(
    'get_goals',
    `List goals. Goals sit above Projects in the PARA hierarchy. Optionally filter by status. Valid statuses: ${schema.goals.properties.Status?.options?.join(', ') || 'check DB'}. The user may use informal language — map to the closest valid value.`,
    {
      status: z.string().optional().describe('Filter by goal status'),
      include_archived: z.boolean().optional().default(false).describe('Include archived goals (default: false)'),
      limit: z.number().int().min(1).max(100).optional().default(30).describe('Max goals (default 30)'),
    },
    async ({ status, include_archived = false, limit = 30 }) => {
      try {
        const filters: NotionFilter[] = [];
        if (status) filters.push({ property: prop('goals', 'Status'), status: { equals: status } });
        if (!include_archived) filters.push({ property: prop('goals', 'Archive'), checkbox: { equals: false } });

        let filter: NotionFilter | undefined;
        if (filters.length === 1) filter = filters[0];
        else if (filters.length > 1) filter = { and: filters } as NotionFilter;

        const pages = await queryWithFallback(
          dbId('goals'),
          filter,
          [{ property: prop('goals', 'Target Deadline'), direction: 'ascending' }],
          limit,
        );
        const goals = pages.map(formatGoal);
        return { content: [{ type: 'text', text: JSON.stringify({ count: goals.length, goals }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- health_check ---
  server.tool(
    'health_check',
    'Diagnose the Max Brain template against the schema this server expects. Returns a structured report: API key status, root page, all 5 databases, every required property (type + status options). Call this proactively when ANY other tool returns an unexpected error — the report tells the user exactly what to fix in their Notion (e.g. "add Low/Medium/High options to Tasks.Priority"). Cheap to call; takes ~3-5 seconds.',
    {},
    async () => {
      try {
        const { runHealthCheck } = await import('./doctor.js');
        const report = await runHealthCheck(notion);
        return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error running health check: ${formatError(err)}` }], isError: true };
      }
    },
  );

  // --- get_daily_summary ---
  server.tool(
    'get_daily_summary',
    'Daily summary: overdue/today tasks, upcoming 7 days, recent notes (3 days). Useful for morning planning.',
    {},
    async () => {
      try {
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const in7Days = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];
        const minus3Days = new Date(now.getTime() - 3 * 86400000).toISOString();

        const doneProp = prop('tasks', 'Done');
        const dueProp = prop('tasks', 'Due');

        const overdueFilter: NotionFilter = {
          and: [
            { property: doneProp, status: { does_not_equal: 'Done' } },
            { property: dueProp, date: { on_or_before: todayStr } },
          ],
        };
        const upcomingFilter: NotionFilter = {
          and: [
            { property: doneProp, status: { does_not_equal: 'Done' } },
            { property: dueProp, date: { after: todayStr } },
            { property: dueProp, date: { on_or_before: in7Days } },
          ],
        };
        const recentNotesFilter: NotionFilter = {
          property: 'Created time',
          created_time: { after: minus3Days },
        };

        const [todayTasks, upcomingTasks, recentNotes] = await Promise.all([
          queryWithFallback(dbId('tasks'), overdueFilter, [{ property: dueProp, direction: 'ascending' }], 20),
          queryWithFallback(dbId('tasks'), upcomingFilter, [{ property: dueProp, direction: 'ascending' }], 20),
          queryWithFallback(dbId('notes'), recentNotesFilter, [{ property: 'Created time', direction: 'descending' }], 10),
        ]);

        const summary = {
          date: todayStr,
          today_and_overdue_tasks: { count: todayTasks.length, tasks: todayTasks.map(formatTask) },
          upcoming_tasks_7_days: { count: upcomingTasks.length, tasks: upcomingTasks.map(formatTask) },
          recent_notes_3_days: { count: recentNotes.length, notes: recentNotes.map(formatNote) },
        };
        return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}` }], isError: true };
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  process.stderr.write('Initializing Notion Brain MCP Server...\n');

  // Build schema (auto-discover DBs + validate properties)
  schema = await buildSchema();

  // Create server with dynamic description from live schema
  const description = buildSystemDescription(schema);
  const server = new McpServer({
    name: 'notion-brain',
    version: '1.0.0',
    description,
  });

  // Register all tools
  registerTools(server);

  // Connect
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Notion Brain MCP Server running on stdio\n');
}

main().catch((error) => {
  process.stderr.write(`Fatal error: ${error}\n`);
  process.exit(1);
});
