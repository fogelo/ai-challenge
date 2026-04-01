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

function loadData(): { users: User[]; tickets: Ticket[] } {
  const users: User[] = JSON.parse(readFileSync(join(DATA_DIR, 'users.json'), 'utf-8'));
  const tickets: Ticket[] = JSON.parse(readFileSync(join(DATA_DIR, 'tickets.json'), 'utf-8'));
  return { users, tickets };
}

const server = new McpServer({
  name: 'server-crm',
  version: '1.0.0',
});

server.registerTool(
  'get_user',
  {
    description: 'Получить профиль пользователя TaskFlow по его ID. Возвращает имя, тариф, статус аккаунта и дату регистрации.',
    inputSchema: { user_id: z.string().describe('ID пользователя') },
  },
  async ({ user_id }) => {
    const { users } = loadData();
    const user = findUser(users, user_id);
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
  },
);

server.registerTool(
  'get_user_tickets',
  {
    description: 'Получить список тикетов поддержки пользователя TaskFlow по его ID.',
    inputSchema: { user_id: z.string().describe('ID пользователя') },
  },
  async ({ user_id }) => {
    const { tickets } = loadData();
    const userTickets = findUserTickets(tickets, user_id);
    if (userTickets.length === 0) {
      return { content: [{ type: 'text' as const, text: `У пользователя ${user_id} нет тикетов.` }] };
    }
    const text = userTickets
      .map((t) => `[${t.id}] ${t.subject}\nСтатус: ${t.status} | Дата: ${t.created}\n${t.description}`)
      .join('\n\n');
    return { content: [{ type: 'text' as const, text }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
