import { Client } from '@notionhq/client';
import { password, checkbox, confirm } from '@inquirer/prompts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getClients, type ClientId, type ClientInfo } from './config-paths.js';

const TEMPLATE_URL = 'https://dkatsiros.notion.site/Max-Brain-9977fa4ee5e683768e3b816d8fd81466';
const PACKAGE_NAME = '@dkatsiros/notion-brain';

function serverBlock(apiKey: string) {
  return {
    command: 'npx',
    args: ['-y', PACKAGE_NAME],
    env: { NOTION_API_KEY: apiKey },
  };
}

async function readJsonIfExists(filePath: string): Promise<Record<string, any> | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    if (!content.trim()) return {};
    return JSON.parse(content);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return null;
    if (err instanceof SyntaxError) {
      throw new Error(`Existing config at ${filePath} is invalid JSON. Fix it manually first, then re-run setup.`);
    }
    throw err;
  }
}

async function backup(filePath: string): Promise<string | null> {
  try {
    const bak = `${filePath}.bak`;
    await fs.copyFile(filePath, bak);
    return bak;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeClientConfig(client: ClientInfo, apiKey: string): Promise<{ created: boolean; bakPath: string | null }> {
  const existing = (await readJsonIfExists(client.configPath)) ?? {};
  const created = !(await readJsonIfExists(client.configPath));
  if (!existing['mcpServers']) existing['mcpServers'] = {};
  existing['mcpServers']['notion-brain'] = serverBlock(apiKey);
  await fs.mkdir(path.dirname(client.configPath), { recursive: true });
  const bakPath = await backup(client.configPath);
  await fs.writeFile(client.configPath, JSON.stringify(existing, null, 2) + '\n');
  return { created, bakPath };
}

async function validateNotionKey(apiKey: string): Promise<{ ok: boolean; integrationName?: string; error?: string }> {
  try {
    const notion = new Client({ auth: apiKey });
    const me = await notion.users.me({});
    const name = (me as { name?: string }).name || 'Notion integration';
    return { ok: true, integrationName: name };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

async function findMaxBrainPage(apiKey: string): Promise<{ found: boolean; pageTitle?: string; pageUrl?: string }> {
  try {
    const notion = new Client({ auth: apiKey });
    const r = await notion.search({
      query: 'Max Brain',
      filter: { value: 'page', property: 'object' },
      page_size: 20,
    });
    for (const item of r.results) {
      if (item.object !== 'page') continue;
      const props = (item as { properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }> }).properties || {};
      const titleProp = Object.values(props).find((v) => v.type === 'title');
      const title = titleProp?.title?.[0]?.plain_text || '';
      if (title.toLowerCase() === 'max brain') {
        return { found: true, pageTitle: title, pageUrl: (item as { url?: string }).url };
      }
    }
    return { found: false };
  } catch {
    return { found: false };
  }
}

export async function run(): Promise<void> {
  console.log('');
  console.log('🧠  Max Brain — Setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('This will configure the Max Brain MCP server in your LLM client(s).');
  console.log('Press Ctrl-C to quit at any time.');
  console.log('');

  // Step 1: prerequisites
  console.log('You\'ll need a Notion integration API key:');
  console.log('  1. Go to https://www.notion.so/my-integrations');
  console.log('  2. Click "+ New integration", name it "Max Brain"');
  console.log('  3. Copy the "Internal Integration Secret" (starts with `ntn_` or `secret_`)');
  console.log('');
  console.log('Then connect that integration to your duplicated Max Brain template page:');
  console.log(`   ${TEMPLATE_URL}`);
  console.log('   (in Notion: open the page → "..." → Connections → add the integration)');
  console.log('');

  // Step 2: collect API key
  const apiKey = (
    await password({
      message: 'Paste your Notion API key:',
      mask: '*',
      validate: (v) => v.trim().length > 10 || 'That doesn\'t look like a Notion key.',
    })
  ).trim();

  // Step 3: validate
  process.stdout.write('Validating key... ');
  const validation = await validateNotionKey(apiKey);
  if (!validation.ok) {
    console.log(`❌ ${validation.error}`);
    console.log('');
    console.log('The Notion API rejected the key. Verify it was copied correctly and try again.');
    process.exitCode = 1;
    return;
  }
  console.log(`✓  Valid (integration: "${validation.integrationName}")`);

  // Step 4: locate template page
  process.stdout.write('Looking for Max Brain page... ');
  const lookup = await findMaxBrainPage(apiKey);
  if (lookup.found) {
    console.log(`✓  Found "${lookup.pageTitle}"`);
  } else {
    console.log('⚠️  Not found.');
    console.log('');
    console.log('   Common causes:');
    console.log('   • You haven\'t duplicated the template yet');
    console.log('   • The integration isn\'t connected to the page');
    console.log('   • You renamed the root page (set ROOT_PAGE_NAME env var to match)');
    console.log('');
    const proceed = await confirm({ message: 'Continue anyway?', default: false });
    if (!proceed) {
      console.log('Setup aborted.');
      return;
    }
  }
  console.log('');

  // Step 5: pick clients
  const allClients = getClients();
  const choices = allClients.map((c) => ({
    name: `${c.label}  ${c.description}`,
    value: c.id,
    checked: c.id === 'claude-desktop',
  }));
  const picked = (await checkbox({
    message: 'Which clients should I configure?',
    choices,
    required: true,
  })) as ClientId[];
  console.log('');

  // Step 6: write configs
  const writeReports: string[] = [];
  for (const clientId of picked) {
    const client = allClients.find((c) => c.id === clientId);
    if (!client) continue;
    try {
      const { created, bakPath } = await writeClientConfig(client, apiKey);
      const action = created ? 'created' : 'updated';
      const bakNote = bakPath ? ` (backup: ${bakPath})` : '';
      console.log(`✓  ${client.label}: ${action} ${client.configPath}${bakNote}`);
      writeReports.push(client.label);
    } catch (err) {
      console.log(`❌ ${client.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 7: done
  console.log('');
  console.log('🎉  Setup complete!');
  console.log('');
  if (writeReports.length > 0) {
    console.log('Restart your client(s) to pick up the new config:');
    for (const c of writeReports) console.log(`  - ${c}`);
    console.log('');
  }
  console.log('Then try asking your LLM:');
  console.log('  • "Show me my active projects"');
  console.log('  • "Give me my daily summary"');
  console.log('  • "Create a task: review the Q3 plan, due Friday, High priority"');
  console.log('');
  console.log('Docs: https://github.com/dkatsiros-dev/maxbrain-mcp#readme');
}
