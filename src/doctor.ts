import { Client } from '@notionhq/client';
import { password } from '@inquirer/prompts';
import {
  DB_KEYS,
  DB_NAME_DEFAULTS,
  PROPERTY_DEFAULTS,
  EXPECTED_STATUS_OPTIONS,
  type DbKey,
} from './schema-defaults.js';

interface BlockListItem {
  id: string;
  type: string;
  has_children?: boolean;
  child_page?: { title: string };
  child_database?: { title: string };
}

export interface Issue {
  level: 'error' | 'warning';
  area: string;
  message: string;
  fix?: string;
}

export interface PropertyCheck {
  db: string;
  property: string;
  actual_type?: string;
  expected_type: string;
  status: 'ok' | 'missing' | 'wrong_type' | 'missing_options';
  detail?: string;
  options?: string[];
}

export interface HealthReport {
  ok: boolean;
  summary: string;
  integration?: string;
  root_page?: { id: string; title: string };
  databases: Record<string, { found: boolean; id?: string }>;
  property_checks: PropertyCheck[];
  errors: Issue[];
  warnings: Issue[];
}

const ROOT_PAGE_NAME = process.env['ROOT_PAGE_NAME'] || 'Max Brain';
const DATABASES_PAGE_NAME = process.env['DATABASES_PAGE_NAME'] || 'Databases';

async function flatten(notion: Client, blockId: string): Promise<BlockListItem[]> {
  const out: BlockListItem[] = [];
  let cursor: string | undefined;
  do {
    const r = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
    for (const b of r.results as BlockListItem[]) {
      if (b.type === 'column_list' || b.type === 'column' || b.type === 'toggle') {
        out.push(...(await flatten(notion, b.id)));
      } else {
        out.push(b);
      }
    }
    cursor = (r as { has_more?: boolean; next_cursor?: string }).has_more ? (r as { next_cursor?: string }).next_cursor : undefined;
  } while (cursor);
  return out;
}

async function findRootPage(notion: Client): Promise<{ id: string; title: string } | null> {
  if (process.env['MAX_BRAIN_PAGE_ID']) {
    const id = process.env['MAX_BRAIN_PAGE_ID'];
    try {
      const p = await notion.pages.retrieve({ page_id: id });
      const titleProp = Object.values((p as { properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }> }).properties || {}).find((v) => v.type === 'title');
      const title = titleProp?.title?.[0]?.plain_text || '';
      return { id, title };
    } catch {
      return null;
    }
  }

  const r = await notion.search({ query: ROOT_PAGE_NAME, filter: { value: 'page', property: 'object' }, page_size: 20 });
  for (const item of r.results) {
    if (item.object !== 'page') continue;
    const props = (item as { properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }> }).properties || {};
    const titleProp = Object.values(props).find((v) => v.type === 'title');
    const title = titleProp?.title?.[0]?.plain_text || '';
    if (title.toLowerCase().trim() === ROOT_PAGE_NAME.toLowerCase().trim()) {
      return { id: item.id, title };
    }
  }
  return null;
}

async function findDatabases(notion: Client, rootPageId: string): Promise<Partial<Record<DbKey, string>>> {
  const result: Partial<Record<DbKey, string>> = {};
  const rootChildren = await flatten(notion, rootPageId);
  let dbContainer = rootChildren.find(
    (b) => b.type === 'child_page' && b.child_page?.title.toLowerCase().trim() === DATABASES_PAGE_NAME.toLowerCase().trim(),
  );

  let candidates: BlockListItem[] = dbContainer ? await flatten(notion, dbContainer.id) : rootChildren;
  for (const key of DB_KEYS) {
    const expectedName = DB_NAME_DEFAULTS[key].toLowerCase().trim();
    const match = candidates.find((b) => b.type === 'child_database' && b.child_database?.title.toLowerCase().trim() === expectedName);
    if (match) result[key] = match.id;
  }
  return result;
}

async function checkDatabase(
  notion: Client,
  dbKey: DbKey,
  dbId: string,
): Promise<{ checks: PropertyCheck[]; issues: Issue[] }> {
  const db = await notion.databases.retrieve({ database_id: dbId });
  const liveProps = (db as { properties: Record<string, { type: string; status?: { options: Array<{ name: string }> } }> }).properties;
  const expected = PROPERTY_DEFAULTS[dbKey];
  const expectedStatus = EXPECTED_STATUS_OPTIONS[dbKey];
  const checks: PropertyCheck[] = [];
  const issues: Issue[] = [];

  const liveLookup: Record<string, { actualName: string; type: string; statusOptions?: string[] }> = {};
  for (const [name, p] of Object.entries(liveProps)) {
    liveLookup[name.toLowerCase().trim()] = {
      actualName: name,
      type: p.type,
      statusOptions: p.status?.options.map((o) => o.name),
    };
  }

  for (const [propName, expectedType] of Object.entries(expected)) {
    const live = liveLookup[propName.toLowerCase().trim()];
    if (!live) {
      checks.push({ db: DB_NAME_DEFAULTS[dbKey], property: propName, expected_type: expectedType, status: 'missing' });
      issues.push({
        level: 'error',
        area: `${DB_NAME_DEFAULTS[dbKey]}.${propName}`,
        message: 'property is missing',
        fix: `Add a ${expectedType} property named "${propName}" to the ${DB_NAME_DEFAULTS[dbKey]} database (or set PROP_${dbKey.toUpperCase()}_${propName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()} env var if you renamed it).`,
      });
      continue;
    }
    if (live.type !== expectedType) {
      checks.push({
        db: DB_NAME_DEFAULTS[dbKey],
        property: live.actualName,
        actual_type: live.type,
        expected_type: expectedType,
        status: 'wrong_type',
      });
      issues.push({
        level: 'warning',
        area: `${DB_NAME_DEFAULTS[dbKey]}.${live.actualName}`,
        message: `expected type "${expectedType}", got "${live.type}"`,
        fix: `Either change the property type in Notion, or accept the current shape (some MCP tools may not work).`,
      });
      continue;
    }

    const expectedOpts = expectedStatus[propName];
    if (expectedOpts && live.statusOptions) {
      const liveSet = new Set(live.statusOptions.map((o) => o.toLowerCase().trim()));
      const missing = expectedOpts.filter((o) => !liveSet.has(o.toLowerCase().trim()));
      if (missing.length > 0) {
        checks.push({
          db: DB_NAME_DEFAULTS[dbKey],
          property: live.actualName,
          actual_type: live.type,
          expected_type: expectedType,
          status: 'missing_options',
          detail: `missing: ${missing.join(', ')}`,
          options: live.statusOptions,
        });
        issues.push({
          level: 'error',
          area: `${DB_NAME_DEFAULTS[dbKey]}.${live.actualName}`,
          message: `missing status option(s): ${missing.join(', ')}`,
          fix: `Add the missing status option(s) in Notion (open the property → "Edit options" → add). Without them, MCP tools that filter by these values will fail.`,
        });
        continue;
      }
    }

    checks.push({
      db: DB_NAME_DEFAULTS[dbKey],
      property: live.actualName,
      actual_type: live.type,
      expected_type: expectedType,
      status: 'ok',
      ...(live.statusOptions ? { options: live.statusOptions } : {}),
    });
  }

  return { checks, issues };
}

// ---------------------------------------------------------------------------
// PUBLIC: pure programmatic check — returns structured report. Called by CLI
// AND by the `health_check` MCP tool.
// ---------------------------------------------------------------------------

export async function runHealthCheck(notion: Client): Promise<HealthReport> {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const databases: Record<string, { found: boolean; id?: string }> = {};
  const propertyChecks: PropertyCheck[] = [];

  let integration: string | undefined;
  try {
    const me = await notion.users.me({});
    integration = (me as { name?: string }).name || 'Notion integration';
  } catch (err) {
    return {
      ok: false,
      summary: 'API key invalid or expired',
      databases: {},
      property_checks: [],
      errors: [{ level: 'error', area: 'API key', message: err instanceof Error ? err.message : String(err), fix: 'Verify your NOTION_API_KEY is correct (https://www.notion.so/my-integrations).' }],
      warnings: [],
    };
  }

  const rootPage = await findRootPage(notion);
  if (!rootPage) {
    const issue: Issue = {
      level: 'error',
      area: `Root page "${ROOT_PAGE_NAME}"`,
      message: 'not found or not accessible to the integration',
      fix: 'Duplicate the Max Brain template into your workspace AND connect this integration to the page (in Notion: "..." → Connections). If you renamed the root page, set ROOT_PAGE_NAME env var.',
    };
    errors.push(issue);
    return {
      ok: false,
      summary: `Root page "${ROOT_PAGE_NAME}" not found`,
      integration,
      databases: {},
      property_checks: [],
      errors,
      warnings,
    };
  }

  const dbIds = await findDatabases(notion, rootPage.id);
  for (const key of DB_KEYS) {
    if (dbIds[key]) {
      databases[DB_NAME_DEFAULTS[key]] = { found: true, id: dbIds[key]! };
    } else {
      databases[DB_NAME_DEFAULTS[key]] = { found: false };
      errors.push({
        level: 'error',
        area: `Databases.${DB_NAME_DEFAULTS[key]}`,
        message: 'database missing',
        fix: `Create a database named "${DB_NAME_DEFAULTS[key]}" inside the "${DATABASES_PAGE_NAME}" sub-page (or set ${key.toUpperCase()}_DB_ID env var).`,
      });
    }
  }

  for (const key of DB_KEYS) {
    if (!dbIds[key]) continue;
    try {
      const { checks, issues } = await checkDatabase(notion, key, dbIds[key]!);
      propertyChecks.push(...checks);
      for (const i of issues) (i.level === 'error' ? errors : warnings).push(i);
    } catch (err) {
      errors.push({
        level: 'error',
        area: DB_NAME_DEFAULTS[key],
        message: `could not retrieve schema: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const ok = errors.length === 0;
  const summary = ok
    ? `Healthy. ${Object.values(databases).filter((d) => d.found).length}/${DB_KEYS.length} databases, ${propertyChecks.filter((c) => c.status === 'ok').length} properties verified, no issues.`
    : `${errors.length} error(s), ${warnings.length} warning(s). ${errors.map((e) => `${e.area}: ${e.message}`).join('; ')}.`;

  return {
    ok,
    summary,
    integration,
    root_page: rootPage,
    databases,
    property_checks: propertyChecks,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// CLI wrapper — pretty-prints the report to terminal
// ---------------------------------------------------------------------------

async function getApiKey(): Promise<string> {
  const fromEnv = process.env['NOTION_API_KEY'];
  if (fromEnv && fromEnv.trim().length > 10) return fromEnv.trim();
  console.log('No NOTION_API_KEY in env.');
  const key = await password({
    message: 'Paste your Notion API key:',
    mask: '*',
    validate: (v) => v.trim().length > 10 || 'Invalid key.',
  });
  return key.trim();
}

export async function run(): Promise<void> {
  console.log('');
  console.log('🩺  Max Brain — Health Check');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const apiKey = await getApiKey();
  const notion = new Client({ auth: apiKey });

  process.stdout.write('\nValidating API key... ');
  const report = await runHealthCheck(notion);

  if (report.integration) {
    console.log(`✓ Valid (integration: "${report.integration}")`);
  } else {
    console.log('❌');
    for (const e of report.errors) console.log(`   ${e.message}`);
    process.exitCode = 1;
    return;
  }

  if (report.root_page) {
    console.log(`Locating "${ROOT_PAGE_NAME}" page... ✓ Found (${report.root_page.id.slice(0, 8)}...)`);
  } else {
    console.log(`Locating "${ROOT_PAGE_NAME}" page... ❌ NOT FOUND`);
    for (const e of report.errors) {
      console.log(`   ${e.message}`);
      if (e.fix) console.log(`   → ${e.fix}`);
    }
    process.exitCode = 1;
    return;
  }

  const dbCount = Object.values(report.databases).filter((d) => d.found).length;
  console.log(`Discovering databases... ${dbCount}/${DB_KEYS.length} found`);
  for (const [name, info] of Object.entries(report.databases)) {
    console.log(`  ${info.found ? '✓' : '❌'} ${name}${info.id ? `  (${info.id.slice(0, 8)}...)` : '  — NOT FOUND'}`);
  }

  // Group property checks by DB
  const byDb = new Map<string, PropertyCheck[]>();
  for (const c of report.property_checks) {
    if (!byDb.has(c.db)) byDb.set(c.db, []);
    byDb.get(c.db)!.push(c);
  }
  for (const [dbName, checks] of byDb) {
    console.log(`\n${dbName.toUpperCase()} schema`);
    for (const c of checks) {
      const icon = c.status === 'ok' ? '✓' : c.status === 'wrong_type' ? '⚠️ ' : '❌';
      const opts = c.options ? ` — options: ${c.options.join(', ')}` : '';
      let line = `  ${icon} ${c.property}`;
      if (c.actual_type) line += ` (${c.actual_type})`;
      else line += ` (${c.expected_type})`;
      if (c.status === 'wrong_type') line += `  expected ${c.expected_type}`;
      if (c.status === 'missing') line += '  — MISSING';
      if (c.status === 'missing_options') line += `  — ${c.detail}`;
      console.log(`${line}${opts}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (report.ok) {
    console.log('🎉  All checks passed. Your Max Brain is healthy.');
    return;
  }

  console.log(`${report.errors.length} error(s), ${report.warnings.length} warning(s):\n`);
  for (const issue of [...report.errors, ...report.warnings]) {
    const icon = issue.level === 'error' ? '❌' : '⚠️ ';
    console.log(`${icon} ${issue.area}: ${issue.message}`);
    if (issue.fix) console.log(`     → ${issue.fix}`);
  }
  console.log('\nFix the errors before relying on the affected MCP tools.');
  process.exitCode = 1;
}
