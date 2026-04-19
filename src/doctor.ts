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

interface Issue {
  level: 'error' | 'warning';
  area: string;
  message: string;
  fix?: string;
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

async function checkDatabase(notion: Client, dbKey: DbKey, dbId: string, issues: Issue[]) {
  const db = await notion.databases.retrieve({ database_id: dbId });
  const liveProps = (db as { properties: Record<string, { type: string; status?: { options: Array<{ name: string }> } }> }).properties;
  const expected = PROPERTY_DEFAULTS[dbKey];
  const expectedStatus = EXPECTED_STATUS_OPTIONS[dbKey];
  const propertyReports: string[] = [];

  // Build case-insensitive lookup
  const liveLookup: Record<string, { actualName: string; type: string; statusOptions?: string[] }> = {};
  for (const [name, p] of Object.entries(liveProps)) {
    liveLookup[name.toLowerCase().trim()] = {
      actualName: name,
      type: p.type,
      statusOptions: p.status?.options.map((o) => o.name),
    };
  }

  // Check expected properties
  for (const [propName, expectedType] of Object.entries(expected)) {
    const live = liveLookup[propName.toLowerCase().trim()];
    if (!live) {
      issues.push({
        level: 'error',
        area: `${DB_NAME_DEFAULTS[dbKey]}.${propName}`,
        message: 'property is missing',
        fix: `Add a ${expectedType} property named "${propName}" to the ${DB_NAME_DEFAULTS[dbKey]} database (or set PROP_${dbKey.toUpperCase()}_${propName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()} env var if you renamed it).`,
      });
      propertyReports.push(`  ❌ ${propName} (${expectedType}) — MISSING`);
      continue;
    }
    if (live.type !== expectedType) {
      issues.push({
        level: 'warning',
        area: `${DB_NAME_DEFAULTS[dbKey]}.${live.actualName}`,
        message: `expected type "${expectedType}", got "${live.type}"`,
        fix: `Either change the property type in Notion, or accept the current shape (some MCP tools may not work).`,
      });
      propertyReports.push(`  ⚠️  ${live.actualName} — type ${live.type} (expected ${expectedType})`);
      continue;
    }

    // Status options check
    const expectedOpts = expectedStatus[propName];
    if (expectedOpts && live.statusOptions) {
      const liveSet = new Set(live.statusOptions.map((o) => o.toLowerCase().trim()));
      const missing = expectedOpts.filter((o) => !liveSet.has(o.toLowerCase().trim()));
      if (missing.length > 0) {
        issues.push({
          level: 'error',
          area: `${DB_NAME_DEFAULTS[dbKey]}.${live.actualName}`,
          message: `missing status option(s): ${missing.join(', ')}`,
          fix: `Add the missing status option(s) in Notion (open the property → "Edit options" → add). Without them, MCP tools that filter by these values will fail.`,
        });
        propertyReports.push(`  ❌ ${live.actualName} (${live.type}) — missing options: ${missing.join(', ')}`);
        continue;
      }
    }

    propertyReports.push(`  ✓ ${live.actualName} (${live.type})${live.statusOptions ? ` — options: ${live.statusOptions.join(', ')}` : ''}`);
  }

  console.log(`\n${DB_NAME_DEFAULTS[dbKey].toUpperCase()} schema (${dbId.slice(0, 8)}...)`);
  for (const line of propertyReports) console.log(line);
}

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
  const issues: Issue[] = [];

  // 1. API key
  process.stdout.write('\nValidating API key... ');
  try {
    const me = await notion.users.me({});
    const name = (me as { name?: string }).name || 'Notion integration';
    console.log(`✓ Valid (integration: "${name}")`);
  } catch (err) {
    console.log('❌');
    console.log(`   ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  // 2. Root page
  process.stdout.write(`Locating "${ROOT_PAGE_NAME}" page... `);
  const rootPage = await findRootPage(notion);
  if (!rootPage) {
    console.log('❌ NOT FOUND');
    console.log(`   The integration cannot see a page titled "${ROOT_PAGE_NAME}".`);
    console.log('   Make sure you have:');
    console.log('     1. Duplicated the template into your Notion workspace');
    console.log('     2. Connected this integration to the page (Notion: "..." → Connections)');
    console.log('     3. Set ROOT_PAGE_NAME env var if you renamed the page');
    process.exitCode = 1;
    return;
  }
  console.log(`✓ Found (${rootPage.id.slice(0, 8)}...)`);

  // 3. Databases discovery
  process.stdout.write('Discovering databases... ');
  const dbIds = await findDatabases(notion, rootPage.id);
  const found = Object.keys(dbIds);
  const missing = DB_KEYS.filter((k) => !(k in dbIds));
  console.log(`${found.length}/5 found`);

  for (const key of DB_KEYS) {
    if (dbIds[key]) {
      console.log(`  ✓ ${DB_NAME_DEFAULTS[key]}  (${dbIds[key]!.slice(0, 8)}...)`);
    } else {
      console.log(`  ❌ ${DB_NAME_DEFAULTS[key]}  — NOT FOUND`);
      issues.push({
        level: 'error',
        area: `Databases.${DB_NAME_DEFAULTS[key]}`,
        message: 'database missing',
        fix: `Create a database named "${DB_NAME_DEFAULTS[key]}" inside the "${DATABASES_PAGE_NAME}" sub-page (or set ${key.toUpperCase()}_DB_ID env var).`,
      });
    }
  }

  // 4. Per-DB schema validation
  for (const key of DB_KEYS) {
    if (!dbIds[key]) continue;
    try {
      await checkDatabase(notion, key, dbIds[key]!, issues);
    } catch (err) {
      console.log(`\n${DB_NAME_DEFAULTS[key].toUpperCase()} schema — could not retrieve`);
      issues.push({
        level: 'error',
        area: DB_NAME_DEFAULTS[key],
        message: `could not retrieve schema: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // 5. Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  if (errors.length === 0 && warnings.length === 0) {
    console.log('🎉  All checks passed. Your Max Brain is healthy.');
    return;
  }

  console.log(`${errors.length} error(s), ${warnings.length} warning(s):\n`);
  for (const issue of issues) {
    const icon = issue.level === 'error' ? '❌' : '⚠️ ';
    console.log(`${icon} ${issue.area}: ${issue.message}`);
    if (issue.fix) console.log(`     → ${issue.fix}`);
  }

  if (errors.length > 0) {
    console.log('\nFix the errors before relying on the affected MCP tools.');
    process.exitCode = 1;
  }
}
