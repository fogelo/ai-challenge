// src/mcp/server-crm.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Путь к данным относительно dist/mcp/ → ../../crm-data/
const DATA_DIR = join(__dirname, '..', '..', 'crm-data');

interface User {
  id: string;
  name: string;
  plan: string;
  status: string;
  registered: string;
  email: string;
}

interface Ticket {
  id: string;
  user_id: string;
  subject: string;
  status: string;
  created: string;
  description: string;
}

export function findUser(users: User[], id: string): User | null {
  return users.find((u) => u.id === id) ?? null;
}

export function findUserTickets(tickets: Ticket[], userId: string): Ticket[] {
  return tickets.filter((t) => t.user_id === userId);
}

const { users: ALL_USERS, tickets: ALL_TICKETS } = (() => {
  const users: User[] = JSON.parse(readFileSync(join(DATA_DIR, 'users.json'), 'utf-8'));
  const tickets: Ticket[] = JSON.parse(readFileSync(join(DATA_DIR, 'tickets.json'), 'utf-8'));
  return { users, tickets };
})();

const server = new McpServer({
  name: 'server-crm',
  version: '1.0.0',
});

server.registerTool(
  'crm_get_user',
  {
    description: 'Получить профиль пользователя TaskFlow по его ID. Возвращает имя, тариф, статус аккаунта и дату регистрации.',
    inputSchema: { user_id: z.string().describe('ID пользователя') },
  },
  async ({ user_id }) => {
    try {
      const user = findUser(ALL_USERS, user_id);
      if (!user) {
        return { content: [{ type: 'text' as const, text: `Пользователь с ID "${user_id}" не найден.` }] };
      }
      const text =
        `Пользователь: ${user.name}\n` +
        `Email: ${user.email}\n` +
        `Тариф: ${user.plan}\n` +
        `Статус: ${user.status}\n` +
        `Зарегистрирован: ${user.registered}`;
      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  },
);

server.registerTool(
  'crm_get_user_tickets',
  {
    description: 'Получить список тикетов поддержки пользователя TaskFlow по его ID.',
    inputSchema: { user_id: z.string().describe('ID пользователя') },
  },
  async ({ user_id }) => {
    try {
      const userTickets = findUserTickets(ALL_TICKETS, user_id);
      if (userTickets.length === 0) {
        return { content: [{ type: 'text' as const, text: `У пользователя ${user_id} нет тикетов.` }] };
      }
      const text = userTickets
        .map((t) => `[${t.id}] ${t.subject}\nСтатус: ${t.status} | Дата: ${t.created}\n${t.description}`)
        .join('\n\n');
      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  },
);

const transport = new StdioServerTransport();
(async () => { await server.connect(transport); })();
