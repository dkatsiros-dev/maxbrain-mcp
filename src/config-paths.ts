import os from 'node:os';
import path from 'node:path';

export type ClientId = 'claude-desktop' | 'claude-code-project' | 'cursor' | 'gemini-cli';

export interface ClientInfo {
  id: ClientId;
  label: string;
  configPath: string;
  description: string;
}

function claudeDesktopConfigPath(home: string): string {
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    const appdata = process.env['APPDATA'] || path.join(home, 'AppData', 'Roaming');
    return path.join(appdata, 'Claude', 'claude_desktop_config.json');
  }
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

export function getClients(cwd: string = process.cwd()): ClientInfo[] {
  const home = os.homedir();
  return [
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      configPath: claudeDesktopConfigPath(home),
      description: 'Anthropic Claude desktop app',
    },
    {
      id: 'claude-code-project',
      label: 'Claude Code (project)',
      configPath: path.join(cwd, '.mcp.json'),
      description: '.mcp.json in current directory',
    },
    {
      id: 'cursor',
      label: 'Cursor',
      configPath: path.join(home, '.cursor', 'mcp.json'),
      description: 'Cursor IDE',
    },
    {
      id: 'gemini-cli',
      label: 'Gemini CLI',
      configPath: path.join(home, '.gemini', 'settings.json'),
      description: 'Google Gemini CLI',
    },
  ];
}
