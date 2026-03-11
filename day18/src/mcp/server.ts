// src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execSync } from 'child_process';
import { get as httpsGet } from 'https';

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    httpsGet(url, { headers: { 'User-Agent': 'curl/7.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const text = await fetchText(url);
  return JSON.parse(text) as T;
}

const server = new McpServer({
  name: 'day17-local-server',
  version: '2.0.0',
});

// ─── Утилиты ───────────────────────────────────────────────────────────────

server.registerTool(
  'get_time',
  {
    description: 'Возвращает текущее дату и время',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text: new Date().toLocaleString('ru-RU') }],
  })
);

server.registerTool(
  'echo',
  {
    description: 'Повторяет переданное сообщение',
    inputSchema: { message: z.string().describe('Текст для повтора') },
  },
  async ({ message }) => ({
    content: [{ type: 'text', text: message }],
  })
);

server.registerTool(
  'get_agent_info',
  {
    description: 'Возвращает информацию о CLI агенте',
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          name: 'AI Agent CLI',
          version: '1.0.0',
          platform: process.platform,
          nodeVersion: process.version,
        }),
      },
    ],
  })
);

// ─── Git API ───────────────────────────────────────────────────────────────

server.registerTool(
  'git_status',
  {
    description: 'Возвращает текущий статус git репозитория (изменённые, новые, удалённые файлы)',
    inputSchema: {
      path: z.string().optional().describe('Путь к репозиторию (по умолчанию текущая директория)'),
    },
  },
  async ({ path: repoPath }) => {
    try {
      const cwd = repoPath || process.cwd();
      const output = execSync('git status', { cwd, encoding: 'utf-8' });
      return { content: [{ type: 'text', text: output }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

server.registerTool(
  'git_log',
  {
    description: 'Возвращает последние коммиты git репозитория',
    inputSchema: {
      path: z.string().optional().describe('Путь к репозиторию'),
      limit: z.number().optional().describe('Количество коммитов (по умолчанию 10)'),
    },
  },
  async ({ path: repoPath, limit }) => {
    try {
      const cwd = repoPath || process.cwd();
      const n = limit ?? 10;
      const output = execSync(`git log --oneline -${n}`, { cwd, encoding: 'utf-8' });
      return { content: [{ type: 'text', text: output }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

server.registerTool(
  'git_diff',
  {
    description: 'Возвращает текущий diff изменений в git репозитории',
    inputSchema: {
      path: z.string().optional().describe('Путь к репозиторию'),
      staged: z.boolean().optional().describe('Показать staged изменения (по умолчанию false)'),
    },
  },
  async ({ path: repoPath, staged }) => {
    try {
      const cwd = repoPath || process.cwd();
      const cmd = staged ? 'git diff --cached' : 'git diff';
      const output = execSync(cmd, { cwd, encoding: 'utf-8' });
      return { content: [{ type: 'text', text: output || '(нет изменений)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// ─── JSONPlaceholder (mock API) ────────────────────────────────────────────

server.registerTool(
  'get_todos',
  {
    description: 'Получает список задач из JSONPlaceholder mock API',
    inputSchema: {
      limit: z.number().optional().describe('Количество задач (по умолчанию 10, максимум 200)'),
      completed: z.boolean().optional().describe('Фильтр по статусу выполнения'),
    },
  },
  async ({ limit, completed }) => {
    try {
      const n = Math.min(limit ?? 10, 200);
      let url = `https://jsonplaceholder.typicode.com/todos?_limit=${n}`;
      if (completed !== undefined) url += `&completed=${completed}`;
      const data = await fetchJson<Array<{ id: number; title: string; completed: boolean; userId: number }>>(url);
      const text = data.map(t => `[${t.completed ? '✓' : ' '}] #${t.id} ${t.title} (user: ${t.userId})`).join('\n');
      return { content: [{ type: 'text', text: text || '(пусто)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

server.registerTool(
  'get_posts',
  {
    description: 'Получает список постов из JSONPlaceholder mock API',
    inputSchema: {
      limit: z.number().optional().describe('Количество постов (по умолчанию 5)'),
      userId: z.number().optional().describe('Фильтр по ID пользователя'),
    },
  },
  async ({ limit, userId }) => {
    try {
      const n = Math.min(limit ?? 5, 100);
      let url = `https://jsonplaceholder.typicode.com/posts?_limit=${n}`;
      if (userId !== undefined) url += `&userId=${userId}`;
      const data = await fetchJson<Array<{ id: number; title: string; body: string; userId: number }>>(url);
      const text = data.map(p => `#${p.id} [user:${p.userId}] ${p.title}\n  ${p.body.slice(0, 80)}...`).join('\n\n');
      return { content: [{ type: 'text', text: text || '(пусто)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

server.registerTool(
  'get_user',
  {
    description: 'Получает информацию о пользователе из JSONPlaceholder mock API',
    inputSchema: {
      userId: z.number().describe('ID пользователя (1-10)'),
    },
  },
  async ({ userId }) => {
    try {
      const u = await fetchJson<{ id: number; name: string; email: string; phone: string; website: string; company: { name: string } }>(
        `https://jsonplaceholder.typicode.com/users/${userId}`
      );
      const text = `Имя: ${u.name}\nEmail: ${u.email}\nТелефон: ${u.phone}\nСайт: ${u.website}\nКомпания: ${u.company.name}`;
      return { content: [{ type: 'text', text: text }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// ─── Погода (wttr.in) ──────────────────────────────────────────────────────

server.registerTool(
  'get_weather',
  {
    description: 'Получает текущую погоду для города через wttr.in (без API ключа)',
    inputSchema: {
      city: z.string().describe('Название города (например: Moscow, London, Tokyo)'),
      format: z.enum(['short', 'full']).optional().describe('Формат ответа: short (одна строка) или full (подробно). По умолчанию short'),
    },
  },
  async ({ city, format }) => {
    try {
      const fmt = format === 'full' ? '?format=4' : '?format=3';
      const url = `https://wttr.in/${encodeURIComponent(city)}${fmt}`;
      const text = await fetchText(url);
      return { content: [{ type: 'text', text: text.trim() }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// ──────────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();
