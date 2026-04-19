import { spawn } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BINARY = path.resolve(__dirname, '..', 'dist', 'index.js');

function runServer(env: Record<string, string>, timeoutMs = 3000, args: string[] = []): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [BINARY, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    const timer = setTimeout(() => proc.kill('SIGTERM'), timeoutMs);
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, stdout });
    });
  });
}

describe('server startup', () => {
  it('exits with error when NOTION_API_KEY is missing', async () => {
    const { stderr } = await runServer({ NOTION_API_KEY: '' }, 2000);
    expect(stderr).toMatch(/NOTION_API_KEY/);
  });

  it('starts and logs initialization banner with valid env', async () => {
    const { stderr } = await runServer({ NOTION_API_KEY: 'ntn_fake_key_for_smoke_test' }, 2500);
    expect(stderr).toContain('Initializing Notion Brain MCP Server');
  });

  it('honors ROOT_PAGE_NAME env override', async () => {
    const { stderr } = await runServer(
      { NOTION_API_KEY: 'ntn_fake_key_for_smoke_test', ROOT_PAGE_NAME: 'CustomRoot' },
      4000,
    );
    expect(stderr).toMatch(/CustomRoot|Initializing/);
  });
});

describe('CLI subcommands', () => {
  it('--help prints usage and exits 0', async () => {
    const { code, stdout } = await runServer({}, 2000, ['--help']);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('notion-brain setup');
    expect(code).toBe(0);
  });

  it('--version prints semver and exits 0', async () => {
    const { code, stdout } = await runServer({}, 2000, ['--version']);
    expect(stdout).toMatch(/^\d+\.\d+\.\d+/);
    expect(code).toBe(0);
  });
});

describe('package integrity', () => {
  it('binary is executable and built', async () => {
    const fs = await import('node:fs');
    expect(fs.existsSync(BINARY)).toBe(true);
    const content = fs.readFileSync(BINARY, 'utf8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });
});
