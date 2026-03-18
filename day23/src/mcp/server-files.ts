// src/mcp/server-files.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const server = new McpServer({ name: 'server-files', version: '1.0.0' });

const OUTPUT_DIR = join(process.cwd(), 'output');

server.registerTool(
  'saveToFile',
  {
    description: 'Сохраняет текст в файл в папке ./output/. Используй как последний шаг пайплайна после summarize.',
    inputSchema: {
      filename: z.string().describe('Имя файла (например: result.txt, summary.md)'),
      content: z.string().describe('Содержимое для сохранения'),
    },
  },
  async ({ filename, content }) => {
    try {
      await mkdir(OUTPUT_DIR, { recursive: true });
      const filePath = join(OUTPUT_DIR, filename);
      await writeFile(filePath, content, 'utf-8');
      return { content: [{ type: 'text', text: `✅ Сохранено: ${filePath}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

server.registerTool(
  'readFile',
  {
    description: 'Читает содержимое файла из папки ./output/.',
    inputSchema: {
      filename: z.string().describe('Имя файла для чтения (например: result.txt)'),
    },
  },
  async ({ filename }) => {
    try {
      const filePath = join(OUTPUT_DIR, filename);
      if (!existsSync(filePath)) {
        return { content: [{ type: 'text', text: `❌ Файл не найден: ${filename}` }] };
      }
      const content = await readFile(filePath, 'utf-8');
      return { content: [{ type: 'text', text: content }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

server.registerTool(
  'listFiles',
  {
    description: 'Показывает список файлов в папке ./output/.',
    inputSchema: {},
  },
  async () => {
    try {
      if (!existsSync(OUTPUT_DIR)) {
        return { content: [{ type: 'text', text: 'Папка output/ пуста или не существует.' }] };
      }
      const files = await readdir(OUTPUT_DIR);
      if (files.length === 0) {
        return { content: [{ type: 'text', text: 'Папка output/ пуста.' }] };
      }
      return { content: [{ type: 'text', text: files.join('\n') }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

const transport = new StdioServerTransport();
(async () => { await server.connect(transport); })();
