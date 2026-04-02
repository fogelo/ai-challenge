// src/mcp/server-project.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile, readdir, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, relative, extname } from 'path';

const server = new McpServer({ name: 'server-project', version: '1.0.0' });

const PROJECT_ROOT = resolve(process.env.PROJECT_ROOT ?? process.cwd());

/** Resolve relative path and verify it stays within PROJECT_ROOT. Throws on traversal. */
function safePath(relativePath: string): string {
  const abs = resolve(PROJECT_ROOT, relativePath);
  if (!abs.startsWith(PROJECT_ROOT + '/') && abs !== PROJECT_ROOT) {
    throw new Error(`Доступ запрещён: путь выходит за пределы проекта (${relativePath})`);
  }
  return abs;
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.ico', '.woff', '.woff2', '.ttf',
]);

server.registerTool(
  'readProjectFile',
  {
    description: 'Читает содержимое файла проекта по относительному пути от PROJECT_ROOT',
    inputSchema: {
      path: z.string().describe('Относительный путь к файлу (например: src/mcp/client.ts)'),
    },
  },
  async ({ path: relPath }) => {
    try {
      const abs = safePath(relPath);
      if (!existsSync(abs)) {
        return { content: [{ type: 'text', text: `❌ Файл не найден: ${relPath}` }] };
      }
      if (BINARY_EXTENSIONS.has(extname(relPath).toLowerCase())) {
        return { content: [{ type: 'text', text: `⚠️ Бинарный файл: ${relPath} (чтение недоступно)` }] };
      }
      const content = await readFile(abs, 'utf-8');
      return { content: [{ type: 'text', text: content }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

async function globFiles(dir: string, pattern: string): Promise<string[]> {
  const results: string[] = [];
  const segments = pattern.split('/');

  async function walk(current: string, segs: string[]): Promise<void> {
    if (segs.length === 0) return;
    const [head, ...rest] = segs;

    if (head === '**') {
      // match zero or more directories
      await walk(current, rest);
      let entries: import('fs').Dirent[];
      try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if ((e.name as string).startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
        if (e.isDirectory()) await walk(join(current, e.name as string), segs);
      }
    } else if (rest.length === 0) {
      // leaf segment — match files
      let entries: import('fs').Dirent[];
      try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
      const regex = new RegExp('^' + head.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$');
      for (const e of entries) {
        if (e.isFile() && regex.test(e.name as string)) {
          results.push(relative(PROJECT_ROOT, join(current, e.name as string)));
        }
      }
    } else {
      // directory segment
      const next = join(current, head);
      if (existsSync(next)) await walk(next, rest);
    }
  }

  await walk(dir, segments);
  return results.sort();
}

server.registerTool(
  'listProjectFiles',
  {
    description: 'Список файлов проекта по glob-паттерну (например: src/**/*.ts)',
    inputSchema: {
      glob: z.string().describe('Glob-паттерн (например: src/**/*.ts, *.json)'),
    },
  },
  async ({ glob }) => {
    try {
      const files = await globFiles(PROJECT_ROOT, glob);
      if (files.length === 0) {
        return { content: [{ type: 'text', text: `Файлы не найдены для паттерна: ${glob}` }] };
      }
      return { content: [{ type: 'text', text: files.join('\n') }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

const transport = new StdioServerTransport();
(async () => { await server.connect(transport); })();
