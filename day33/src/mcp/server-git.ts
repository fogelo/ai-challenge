// src/mcp/server-git.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';

const server = new McpServer({ name: 'server-git', version: '1.0.0' });

server.registerTool(
  'get_branch',
  {
    description: 'Возвращает текущую git-ветку проекта',
    inputSchema: {},
  },
  async () => {
    try {
      const branch = execSync('git branch --show-current', {
        cwd: process.cwd(),
        encoding: 'utf-8',
      }).trim();
      return { content: [{ type: 'text', text: branch || '(detached HEAD)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

function listFilesRecursive(dir: string, depth = 0): string[] {
  if (depth > 4) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const indent = '  '.repeat(depth);
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`);
      lines.push(...listFilesRecursive(full, depth + 1));
    } else {
      lines.push(`${indent}${entry.name}`);
    }
  }
  return lines;
}

server.registerTool(
  'list_files',
  {
    description: 'Возвращает структуру файлов проекта (src/, без node_modules и dist)',
    inputSchema: {
      dir: z.string().optional().describe('Директория для листинга (по умолчанию src/)'),
    },
  },
  async ({ dir }) => {
    try {
      const targetDir = join(process.cwd(), dir ?? 'src');
      const lines = listFilesRecursive(targetDir);
      return { content: [{ type: 'text', text: lines.join('\n') || '(пусто)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

server.registerTool(
  'get_diff',
  {
    description: 'Возвращает статистику изменений последних коммитов (git diff HEAD~n --stat)',
    inputSchema: {
      n: z.number().optional().describe('Глубина (по умолчанию 1 — последний коммит)'),
    },
  },
  async ({ n }) => {
    try {
      const depth = n ?? 1;
      const output = execSync(`git diff HEAD~${depth} --stat`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      return { content: [{ type: 'text', text: output || '(нет изменений)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

const transport = new StdioServerTransport();
(async () => { await server.connect(transport); })();
