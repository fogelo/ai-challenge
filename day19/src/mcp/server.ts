// src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execSync } from 'child_process';
import { get as httpsGet } from 'https';
import { get as httpGet } from 'http';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  addReminder,
  loadReminders,
  updateReminderStatus,
  getFiredReminders,
  ReminderScheduler,
} from '../reminders/index.js';
import { Reminder } from '../types/index.js';

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const makeRequest = (currentUrl: string, redirectsLeft: number) => {
      const getter = currentUrl.startsWith('https://') ? httpsGet : httpGet;
      getter(currentUrl, { headers: { 'User-Agent': 'curl/7.0' } }, (res) => {
        const { statusCode, headers } = res;
        if ((statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) && headers.location) {
          if (redirectsLeft === 0) { reject(new Error('Too many redirects')); return; }
          const next = headers.location.startsWith('http') ? headers.location : new URL(headers.location, currentUrl).toString();
          res.resume();
          makeRequest(next, redirectsLeft - 1);
          return;
        }
        if (!statusCode || statusCode < 200 || statusCode >= 300) {
          reject(new Error(`HTTP ${statusCode ?? 'unknown'}`));
          return;
        }
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve(data));
      }).on('error', reject);
    };
    makeRequest(url, 5);
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const text = await fetchText(url);
  return JSON.parse(text) as T;
}

const server = new McpServer({
  name: 'day18-local-server',
  version: '3.0.0',
});

const scheduler = new ReminderScheduler();

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

// ─── Напоминания ───────────────────────────────────────────────────────────

server.registerTool(
  'create_reminder',
  {
    description: 'Создаёт одиночное напоминание, которое сработает через указанное количество минут',
    inputSchema: {
      text: z.string().describe('Текст напоминания'),
      minutes: z.number().int().positive().describe('Через сколько минут напомнить'),
    },
  },
  async ({ text, minutes }) => {
    try {
      const now = new Date();
      const scheduledAt = new Date(now.getTime() + minutes * 60 * 1000);
      const reminder: Reminder = {
        id: randomUUID(),
        text,
        createdAt: now.toISOString(),
        scheduledAt: scheduledAt.toISOString(),
        status: 'pending',
      };
      await addReminder(reminder);
      scheduler.schedule(reminder.id, minutes * 60 * 1000);
      return {
        content: [
          {
            type: 'text',
            text: `✅ Напоминание создано: "${text}"\nСработает в: ${scheduledAt.toLocaleString('ru-RU')}\nID: ${reminder.id}`,
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

server.registerTool(
  'list_reminders',
  {
    description: 'Возвращает список всех напоминаний со статусами',
    inputSchema: {},
  },
  async () => {
    try {
      const reminders = await loadReminders();
      if (reminders.length === 0) {
        return { content: [{ type: 'text', text: 'Напоминаний нет.' }] };
      }
      const statusIcon: Record<Reminder['status'], string> = {
        pending: '⏳',
        fired: '🔔',
        shown: '✓',
        cancelled: '✗',
      };
      const lines = reminders.map(
        (r) =>
          `${statusIcon[r.status]} [${r.status}] "${r.text}"\n  Время: ${new Date(r.scheduledAt).toLocaleString('ru-RU')}\n  ID: ${r.id}`
      );
      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

server.registerTool(
  'cancel_reminder',
  {
    description: 'Отменяет ожидающее напоминание по ID',
    inputSchema: {
      id: z.string().describe('ID напоминания'),
    },
  },
  async ({ id }) => {
    try {
      const reminders = await loadReminders();
      const reminder = reminders.find((r) => r.id === id);

      if (!reminder) {
        return { content: [{ type: 'text', text: `❌ Напоминание не найдено: ${id}` }] };
      }
      if (reminder.status !== 'pending') {
        return {
          content: [
            {
              type: 'text',
              text: `❌ Нельзя отменить напоминание со статусом "${reminder.status}"`,
            },
          ],
        };
      }

      scheduler.cancel(id);
      await updateReminderStatus(id, 'cancelled');
      return { content: [{ type: 'text', text: `✅ Напоминание отменено: "${reminder.text}"` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// Только для внутреннего polling из Chat.tsx — не показывается LLM через listTools()
server.registerTool(
  'check_fired_reminders',
  {
    description: 'Возвращает напоминания которые сработали но ещё не показаны. Только для внутреннего polling.',
    inputSchema: {},
  },
  async () => {
    try {
      const fired = await getFiredReminders();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(fired),
          },
        ],
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// ─── Pipeline ──────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

server.registerTool(
  'search',
  {
    description: 'Получает текстовое содержимое веб-страницы по HTTPS URL. Возвращает очищенный от HTML текст (до 8000 символов). Используй как первый шаг пайплайна: search → summarize → saveToFile.',
    inputSchema: {
      url: z.string().describe('HTTPS URL страницы для анализа'),
    },
  },
  async ({ url }) => {
    try {
      if (!url.startsWith('https://')) {
        return { content: [{ type: 'text', text: '❌ Поддерживаются только HTTPS URL' }] };
      }
      const html = await fetchText(url);
      const text = stripHtml(html).slice(0, 8000);
      return { content: [{ type: 'text', text: text || '(пустая страница)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

server.registerTool(
  'summarize',
  {
    description: 'Суммаризирует переданный текст с помощью LLM в 3-5 предложениях. Используй как второй шаг пайплайна после search.',
    inputSchema: {
      text: z.string().describe('Текст для суммаризации'),
      instructions: z.string().optional().describe('Дополнительные инструкции (например: "на русском языке", "фокус на технических деталях")'),
    },
  },
  async ({ text, instructions }) => {
    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return { content: [{ type: 'text', text: '❌ OPENROUTER_API_KEY не найден' }] };
      }

      if (!text.trim()) {
        return { content: [{ type: 'text', text: '❌ Текст для суммаризации не может быть пустым' }] };
      }

      const userPrompt = instructions
        ? `${instructions}\n\nТекст:\n${text}`
        : `Текст:\n${text}`;

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-flash-1.5',
          messages: [
            {
              role: 'system',
              content: 'Ты помощник для суммаризации текста. Создай краткое резюме в 3-5 предложениях.',
            },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { content: [{ type: 'text', text: `❌ OpenRouter ошибка (${response.status}): ${err}` }] };
      }

      const data = await response.json() as { choices: Array<{ message: { content: string } }> };
      const summary = data.choices?.[0]?.message?.content ?? '(пустой ответ)';
      return { content: [{ type: 'text', text: summary }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

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
      const outputDir = join(process.cwd(), 'output');
      await mkdir(outputDir, { recursive: true });
      const filePath = join(outputDir, filename);
      await writeFile(filePath, content, 'utf-8');
      return { content: [{ type: 'text', text: `✅ Сохранено: ${filePath}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

// ──────────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
(async () => {
  await scheduler.initialize();
  await server.connect(transport);
})();
