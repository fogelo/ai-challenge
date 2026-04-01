# Support Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить команду `/support <user_id>` в CLI-агент, которая переключает его в режим AI-поддержки пользователей TaskFlow с RAG по FAQ и CRM-контекстом через MCP.

**Architecture:** Новый MCP-сервер `server-crm.ts` читает JSON-фикстуры с пользователями и тикетами. Skill `support` в системном промпте инструктирует LLM автоматически вызывать CRM-инструменты. Отдельный `supportRagManager` ищет по `for_rag/support/` и инжектирует контекст перед каждым запросом.

**Tech Stack:** TypeScript, Ink/React, `@modelcontextprotocol/sdk`, `zod`, vitest, path/fs (Node.js)

---

## File Map

| Файл | Действие | Ответственность |
|------|----------|-----------------|
| `crm-data/users.json` | Создать | 6 пользователей TaskFlow |
| `crm-data/tickets.json` | Создать | 12 тикетов поддержки |
| `for_rag/support/faq.md` | Создать | FAQ по продукту TaskFlow |
| `for_rag/support/docs.md` | Создать | Документация функций TaskFlow |
| `src/mcp/server-crm.ts` | Создать | MCP-сервер: get_user, get_user_tickets |
| `src/mcp/server-crm.test.ts` | Создать | Unit-тесты чистых функций CRM |
| `src/mcp/client.ts` | Изменить | Добавить server-crm в SERVERS |
| `src/skills/index.ts` | Изменить | Добавить skill `support` |
| `src/components/Chat.tsx` | Изменить | Команда /support, supportMode, RAG-инжект |

---

### Task 1: CRM data fixtures

**Files:**
- Create: `crm-data/users.json`
- Create: `crm-data/tickets.json`

- [ ] **Step 1: Создать директорию и users.json**

```bash
mkdir -p crm-data
```

Содержимое `crm-data/users.json`:
```json
[
  { "id": "1", "name": "Иван Петров", "plan": "Pro", "status": "active", "registered": "2024-03-15", "email": "ivan@example.com" },
  { "id": "2", "name": "Мария Сидорова", "plan": "Free", "status": "active", "registered": "2024-11-01", "email": "maria@example.com" },
  { "id": "3", "name": "Алексей Козлов", "plan": "Pro", "status": "suspended", "registered": "2023-07-22", "email": "alex@example.com" },
  { "id": "4", "name": "Елена Новикова", "plan": "Enterprise", "status": "active", "registered": "2022-05-10", "email": "elena@corp.com" },
  { "id": "5", "name": "Дмитрий Фёдоров", "plan": "Free", "status": "active", "registered": "2025-01-08", "email": "dmitry@example.com" },
  { "id": "6", "name": "Ольга Морозова", "plan": "Pro", "status": "active", "registered": "2024-09-30", "email": "olga@example.com" }
]
```

- [ ] **Step 2: Создать tickets.json**

Содержимое `crm-data/tickets.json`:
```json
[
  { "id": "t1", "user_id": "1", "subject": "Не работает OAuth через GitHub", "status": "open", "created": "2026-03-28", "description": "После нажатия 'Войти через GitHub' страница возвращает ошибку 500. Браузер: Chrome 123. Тестировал на двух аккаунтах." },
  { "id": "t2", "user_id": "1", "subject": "Не отображаются уведомления", "status": "resolved", "created": "2026-02-14", "description": "Уведомления о дедлайнах задач не приходят на email. Решено: пользователь включил фильтр спама." },
  { "id": "t3", "user_id": "2", "subject": "Хочу добавить участников в доску", "status": "open", "created": "2026-03-30", "description": "На тарифе Free кнопка 'Пригласить участника' неактивна. Непонятно почему." },
  { "id": "t4", "user_id": "3", "subject": "Аккаунт заблокирован", "status": "open", "created": "2026-03-25", "description": "При входе сообщение 'Аккаунт приостановлен'. Не могу войти уже 3 дня. Оплата Pro прошла." },
  { "id": "t5", "user_id": "3", "subject": "Нет интеграции с Jira", "status": "closed", "created": "2025-12-01", "description": "Спрашивал про интеграцию с Jira. Ответили, что в Enterprise." },
  { "id": "t6", "user_id": "4", "subject": "Настройка SSO для команды", "status": "open", "created": "2026-03-29", "description": "Нужна помощь с настройкой Single Sign-On через Okta для 50 сотрудников." },
  { "id": "t7", "user_id": "4", "subject": "Экспорт задач в CSV", "status": "resolved", "created": "2026-01-15", "description": "Как экспортировать все задачи проекта? Решено: кнопка '...' в правом верхнем углу доски." },
  { "id": "t8", "user_id": "5", "subject": "Как создать первую доску", "status": "resolved", "created": "2026-03-31", "description": "Новый пользователь, не нашёл кнопку. Решено: кнопка '+ Новая доска' на главной странице." },
  { "id": "t9", "user_id": "5", "subject": "Лимит задач на Free тарифе", "status": "open", "created": "2026-04-01", "description": "Получил ошибку 'Достигнут лимит задач'. Сколько задач доступно на бесплатном тарифе?" },
  { "id": "t10", "user_id": "6", "subject": "Интеграция со Slack не работает", "status": "open", "created": "2026-03-27", "description": "Настроила Slack-интеграцию, но уведомления в канал не приходят. Webhook создан, права выданы." },
  { "id": "t11", "user_id": "6", "subject": "Отмена подписки Pro", "status": "open", "created": "2026-04-01", "description": "Хочу перейти на Free план. Как отменить автопродление Pro?" },
  { "id": "t12", "user_id": "2", "subject": "Забыла пароль", "status": "resolved", "created": "2026-03-20", "description": "Не работала кнопка сброса пароля. Решено: ссылка шла в спам." }
]
```

- [ ] **Step 3: Commit**

```bash
git add crm-data/
git commit -m "feat(day33): add CRM data fixtures (users + tickets)"
```

---

### Task 2: Support RAG documents

**Files:**
- Create: `for_rag/support/faq.md`
- Create: `for_rag/support/docs.md`

- [ ] **Step 1: Создать for_rag/support/faq.md**

```bash
mkdir -p for_rag/support
```

Содержимое `for_rag/support/faq.md`:
```markdown
# TaskFlow — Часто задаваемые вопросы (FAQ)

## Авторизация и доступ

### Почему не работает вход через GitHub/Google?
OAuth-вход может не работать по следующим причинам:
- Временные проблемы на стороне провайдера (GitHub/Google). Попробуйте через 10 минут.
- Браузер блокирует всплывающие окна — разрешите popup для taskflow.app.
- Аккаунт GitHub не подтверждён email-адресом.
- Если ошибка 500 — обратитесь в поддержку с указанием браузера и времени попытки.

### Как сбросить пароль?
На странице входа нажмите «Забыли пароль?». Ссылка приходит на email в течение 5 минут.
Проверьте папку «Спам» — письма иногда туда попадают.

### Аккаунт заблокирован (suspended)
Аккаунт блокируется при: неоплаченном счёте, нарушении условий использования или подозрительной активности.
Если оплата прошла, но аккаунт заблокирован — обратитесь в поддержку с чеком об оплате.

### Что такое SSO?
Single Sign-On (SSO) доступен на тарифе Enterprise. Поддерживаются: Okta, Azure AD, Google Workspace.
Настройка через раздел Settings → Security → SSO Configuration.

## Тарифы и оплата

### Чем отличаются тарифы?
| Функция | Free | Pro | Enterprise |
|---------|------|-----|-----------|
| Досок | 3 | Неограничено | Неограничено |
| Задач на доску | 50 | Неограничено | Неограничено |
| Участников | 1 (только вы) | До 10 | Неограничено |
| Интеграции | — | Slack, GitHub | Slack, GitHub, Jira, Salesforce |
| SSO | — | — | ✓ |
| Экспорт CSV | — | ✓ | ✓ |
| Поддержка | Email (48ч) | Email (24ч) | Приоритетная (4ч) |

### Как отменить подписку Pro?
Settings → Billing → Manage Subscription → Cancel Plan.
Подписка остаётся активной до конца оплаченного периода, затем переключается на Free.
Данные не удаляются, но доступ к функциям Pro ограничивается.

### Как перейти на Enterprise?
Свяжитесь с отделом продаж через кнопку «Upgrade to Enterprise» в настройках.
Цена зависит от количества пользователей.

### Почему списывается оплата?
Подписка автоматически продлевается. Счёт приходит на email за 3 дня до списания.
История платежей: Settings → Billing → Payment History.

## Интеграции

### Как настроить интеграцию со Slack?
Settings → Integrations → Slack → Connect.
Выберите workspace и канал для уведомлений.
Убедитесь, что у бота TaskFlow есть права на публикацию в канале.
Если уведомления не приходят — проверьте права бота командой `/taskflow test` в Slack.

### Как подключить GitHub?
Settings → Integrations → GitHub → Connect Repository.
После подключения коммиты автоматически привязываются к задачам по номеру (#123).

### Есть ли интеграция с Jira?
Только на тарифе Enterprise. Позволяет синхронизировать задачи между TaskFlow и Jira.

## Функции продукта

### Как пригласить участника в доску?
На тарифе Free приглашение участников недоступно — только личные доски.
На Pro: откройте доску → кнопка «Участники» в шапке → «Пригласить» → введите email.

### Как экспортировать задачи?
На тарифе Pro и Enterprise: откройте доску → меню «...» (три точки) → «Экспорт CSV».
На Free экспорт недоступен.

### Сколько задач на Free тарифе?
На тарифе Free: до 3 досок, до 50 задач на каждой доске.
При достижении лимита появляется сообщение «Достигнут лимит задач».
Для снятия ограничений — перейдите на Pro.
```

- [ ] **Step 2: Создать for_rag/support/docs.md**

Содержимое `for_rag/support/docs.md`:
```markdown
# TaskFlow — Документация продукта

## Обзор

TaskFlow — SaaS таск-менеджер для команд. Позволяет создавать доски, задачи, назначать исполнителей, ставить дедлайны и интегрировать с внешними сервисами.

## Основные концепции

### Доска (Board)
Рабочее пространство для проекта. Содержит колонки (To Do / In Progress / Done) и задачи.
На Free тарифе: максимум 3 доски.

### Задача (Task)
Единица работы на доске. Содержит: название, описание, исполнителя, дедлайн, приоритет, теги.
Задачи можно перетаскивать между колонками.

### Участник (Member)
Пользователь, добавленный в доску. Может просматривать и редактировать задачи.
На Free — только владелец. На Pro — до 10 участников. На Enterprise — без ограничений.

## Навигация

- **Главная страница** — список всех досок. Кнопка «+ Новая доска» для создания.
- **Настройки** — Settings в левом нижнем углу. Разделы: Profile, Billing, Integrations, Security.
- **Уведомления** — колокольчик в правом верхнем углу. Настраиваются в Settings → Notifications.

## Статусы аккаунта

- **active** — аккаунт работает нормально
- **suspended** — аккаунт приостановлен (проблема с оплатой или нарушение правил)
- **trial** — пробный период (14 дней, функции Pro)

## Авторизация

Поддерживаемые методы входа:
- Email + пароль
- OAuth: GitHub, Google
- SSO (только Enterprise): Okta, Azure AD, Google Workspace

## Уведомления

Типы уведомлений (Settings → Notifications):
- Email-уведомления о назначенных задачах
- Email-напоминания о дедлайнах
- Push-уведомления в браузере
- Slack-уведомления (при настроенной интеграции)

## Экспорт данных

Форматы экспорта (Pro/Enterprise): CSV, JSON.
Путь: Доска → «...» → «Экспорт».

## Лимиты тарифов

| Параметр | Free | Pro | Enterprise |
|----------|------|-----|-----------|
| Досок | 3 | ∞ | ∞ |
| Задач на доску | 50 | ∞ | ∞ |
| Участников на доску | 1 | 10 | ∞ |
| Хранилище файлов | 100 МБ | 10 ГБ | 1 ТБ |
| История активности | 30 дней | 1 год | ∞ |
```

- [ ] **Step 3: Commit**

```bash
git add for_rag/support/
git commit -m "feat(day33): add support RAG documents (FAQ + docs)"
```

---

### Task 3: MCP server server-crm.ts

**Files:**
- Create: `src/mcp/server-crm.ts`
- Create: `src/mcp/server-crm.test.ts`

- [ ] **Step 1: Написать тест (TDD)**

Содержимое `src/mcp/server-crm.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { findUser, findUserTickets } from './server-crm.js';

const users = [
  { id: '1', name: 'Иван Петров', plan: 'Pro', status: 'active', registered: '2024-03-15', email: 'ivan@example.com' },
  { id: '2', name: 'Мария Сидорова', plan: 'Free', status: 'active', registered: '2024-11-01', email: 'maria@example.com' },
];

const tickets = [
  { id: 't1', user_id: '1', subject: 'OAuth не работает', status: 'open', created: '2026-03-28', description: 'Ошибка 500' },
  { id: 't2', user_id: '1', subject: 'Уведомления', status: 'resolved', created: '2026-02-14', description: 'Решено' },
  { id: 't3', user_id: '2', subject: 'Участники', status: 'open', created: '2026-03-30', description: 'Кнопка неактивна' },
];

describe('findUser', () => {
  it('returns user by id', () => {
    const result = findUser(users, '1');
    expect(result?.name).toBe('Иван Петров');
  });

  it('returns null for unknown id', () => {
    expect(findUser(users, '999')).toBeNull();
  });
});

describe('findUserTickets', () => {
  it('returns tickets for user', () => {
    const result = findUserTickets(tickets, '1');
    expect(result).toHaveLength(2);
    expect(result[0].subject).toBe('OAuth не работает');
  });

  it('returns empty array when user has no tickets', () => {
    expect(findUserTickets(tickets, '99')).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
npm test -- src/mcp/server-crm.test.ts
```

Ожидаемый результат: FAIL — `Cannot find module './server-crm.js'`

- [ ] **Step 3: Создать server-crm.ts**

Содержимое `src/mcp/server-crm.ts`:
```typescript
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
```

- [ ] **Step 4: Запустить тест — убедиться что проходит**

```bash
npm test -- src/mcp/server-crm.test.ts
```

Ожидаемый результат: PASS (2 describe, 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server-crm.ts src/mcp/server-crm.test.ts
git commit -m "feat(day33): add server-crm MCP server with get_user and get_user_tickets"
```

---

### Task 4: Register server-crm in MCP client

**Files:**
- Modify: `src/mcp/client.ts` (line ~33)

- [ ] **Step 1: Добавить server-crm в SERVERS**

В файле `src/mcp/client.ts` найти массив `SERVERS` и добавить строку:

```typescript
// До изменения:
private static readonly SERVERS: ServerConfig[] = [
  { name: 'server-web',   file: 'server-web.js' },
  { name: 'server-ai',    file: 'server-ai.js' },
  { name: 'server-files', file: 'server-files.js' },
  { name: 'server-utils', file: 'server-utils.js' },
  { name: 'server-git',   file: 'server-git.js' },
];

// После изменения:
private static readonly SERVERS: ServerConfig[] = [
  { name: 'server-web',   file: 'server-web.js' },
  { name: 'server-ai',    file: 'server-ai.js' },
  { name: 'server-files', file: 'server-files.js' },
  { name: 'server-utils', file: 'server-utils.js' },
  { name: 'server-git',   file: 'server-git.js' },
  { name: 'server-crm',   file: 'server-crm.js' },
];
```

- [ ] **Step 2: Собрать проект и проверить что компиляция проходит**

```bash
npm run build
```

Ожидаемый результат: успешная компиляция, файл `dist/mcp/server-crm.js` создан.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/client.ts
git commit -m "feat(day33): register server-crm in MCP client"
```

---

### Task 5: Add support skill

**Files:**
- Modify: `src/skills/index.ts`

- [ ] **Step 1: Добавить skill `support`**

В файле `src/skills/index.ts` добавить `support` в объект `SKILLS`:

```typescript
// До изменения:
export const SKILLS: Record<string, string> = {
  interview: `...`,
  brief: `...`,
  summarize: `...`,
};

// После изменения (добавить в конец объекта):
export const SKILLS: Record<string, string> = {
  interview: `...`,   // оставить как есть
  brief: `...`,       // оставить как есть
  summarize: `...`,   // оставить как есть
  support:
    `Ты агент поддержки TaskFlow — SaaS таск-менеджера.
При каждом вопросе пользователя:
1. Вызови инструмент get_user чтобы получить профиль пользователя (тариф, статус).
2. Вызови инструмент get_user_tickets чтобы получить его открытые тикеты.
3. Учитывай контекст тикетов при ответе — если у пользователя есть открытый тикет по теме вопроса, ссылайся на него.
4. Если вопрос касается функций продукта — объясни с учётом тарифа пользователя.
Отвечай кратко, дружелюбно, на языке пользователя. Не повторяй информацию о пользователе в каждом ответе.`,
};
```

- [ ] **Step 2: Проверить компиляцию**

```bash
npm run build
```

Ожидаемый результат: успешная компиляция без ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/skills/index.ts
git commit -m "feat(day33): add support skill"
```

---

### Task 6: Add /support command to Chat.tsx

**Files:**
- Modify: `src/components/Chat.tsx`

Добавляем в Chat.tsx:
1. Состояние `supportUserId` и `supportRagManager`
2. Команду `/support <user_id>` / `/support off` / `/support index`
3. Инжект RAG-контекста из support docs в system prompt когда `supportUserId` установлен

- [ ] **Step 1: Добавить состояние supportUserId и supportRagManager**

Найти в `src/components/Chat.tsx` строку создания `ragManager` (≈ строка 252) и добавить после неё:

```typescript
// После существующего ragManager:
const [ragManager] = useState(() => new RagManager({
  sourcePath: path.resolve('for_rag/project-docs'),
  outputPath: path.resolve('rag-data'),
  embeddingModel: 'nomic-embed-text',
  ollamaUrl: 'http://localhost:11434',
  topK: 3,
  chunkSize: 500,
  chunkOverlap: 100,
}));

// Добавить:
const [supportUserId, setSupportUserId] = useState<string | null>(null);
const [supportRagManager] = useState(() => new RagManager({
  sourcePath: path.resolve('for_rag/support'),
  outputPath: path.resolve('rag-data/support'),
  embeddingModel: 'nomic-embed-text',
  ollamaUrl: 'http://localhost:11434',
  topK: 3,
  chunkSize: 500,
  chunkOverlap: 100,
}));
```

- [ ] **Step 2: Добавить обработку команды /support**

Найти в `handleCommand` блок с командой `/review` (≈ строка 1472) и добавить ДО него обработку `/support`:

```typescript
// /support command — поддержка пользователей
if (trimmed.startsWith('/support')) {
  const arg = trimmed.slice('/support'.length).trim();

  if (arg === 'off') {
    setSupportUserId(null);
    setActiveSkills((prev) => prev.filter((s) => s !== 'support'));
    setNotification('🔕 Режим поддержки выключен');
    return true;
  }

  if (arg === 'index') {
    setIsLoading(true);
    try {
      await supportRagManager.index();
      setNotification('✅ Индекс поддержки построен. Теперь можно использовать /support <user_id>');
    } catch (err) {
      setNotification(`❌ Ошибка индексации: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
    return true;
  }

  if (!arg) {
    setNotification(
      'Использование:\n' +
      '  /support <user_id>   — включить режим поддержки для пользователя\n' +
      '  /support off         — выключить режим поддержки\n' +
      '  /support index       — проиндексировать FAQ и документацию\n' +
      'Пример: /support 1'
    );
    return true;
  }

  // /support <user_id>
  setSupportUserId(arg);
  setActiveSkills((prev) =>
    prev.includes('support' as SkillName) ? prev : [...prev, 'support' as SkillName]
  );
  setNotification(`🎧 Режим поддержки: user #${arg}\nMCP: get_user и get_user_tickets доступны.\nДля выхода: /support off`);
  return true;
}
```

- [ ] **Step 3: Инжектировать RAG-контекст поддержки в system prompt**

Найти в основном обработчике сообщений (после `handleCommand`) блок где строится `finalSystemPrompt` (≈ строка 2292):

```typescript
const finalSystemPrompt = mcpTools.length > 0
  ? (systemPrompt || '') + `\n\n=== MCP ИНСТРУМЕНТЫ ===\n...`
  : systemPrompt;
```

Заменить на:

```typescript
// Инжект RAG-контекста поддержки если активен режим /support
let supportRagContext = '';
if (supportUserId) {
  try {
    const supportResults = await supportRagManager.search(userInput, 'structural', 4);
    if (supportResults.length > 0) {
      supportRagContext = '\n\n=== ДОКУМЕНТАЦИЯ TASKFLOW ===\n' +
        supportResults.map((r) => r.chunk.text).join('\n---\n');
    }
  } catch {
    // Индекс не построен — пропускаем RAG, MCP-контекст всё равно доступен
  }
}

const baseWithRag = supportRagContext ? (systemPrompt || '') + supportRagContext : systemPrompt;
const finalSystemPrompt = mcpTools.length > 0
  ? (baseWithRag || '') + `\n\n=== MCP ИНСТРУМЕНТЫ ===\nДоступны инструменты: ${mcpTools.map(t => t.name).join(', ')}.\nДля простых информационных вопросов (время, данные, факты) — используй инструменты СРАЗУ, без планирования и уточняющих вопросов.`
  : baseWithRag;
```

- [ ] **Step 4: Собрать и запустить проверку типов**

```bash
npm run build
```

Ожидаемый результат: успешная компиляция без ошибок TypeScript.

- [ ] **Step 5: Запустить все тесты**

```bash
npm test
```

Ожидаемый результат: все тесты проходят (включая новый server-crm.test.ts).

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(day33): add /support command with CRM context and RAG injection"
```

---

### Task 7: Manual smoke test

- [ ] **Step 1: Запустить агент**

```bash
npm start
```

- [ ] **Step 2: Подключить MCP**

```
/mcp
```

Ожидаемый результат: список серверов включает `server-crm` с инструментами `get_user` и `get_user_tickets`.

- [ ] **Step 3: Проиндексировать support docs (нужен запущенный Ollama)**

```
/support index
```

Ожидаемый результат: `✅ Индекс поддержки построен`

*Если Ollama недоступен — пропустить, RAG-контекст не инжектируется, но MCP работает.*

- [ ] **Step 4: Сценарий 1 — авторизация**

```
/support 1
Почему не работает авторизация?
```

Ожидаемый результат: агент вызывает `get_user("1")` и `get_user_tickets("1")`, видит тикет t1 (OAuth через GitHub), отвечает с учётом открытого тикета.

- [ ] **Step 5: Сценарий 2 — апгрейд**

```
/support 3
Хочу перейти на Enterprise
```

Ожидаемый результат: агент видит тариф Pro и статус suspended, предлагает сначала восстановить аккаунт, затем описывает преимущества Enterprise.

- [ ] **Step 6: Сценарий 3 — неизвестный пользователь**

```
/support 999
Привет
```

Ожидаемый результат: агент сообщает что пользователь 999 не найден.

- [ ] **Step 7: Выход из режима**

```
/support off
```

Ожидаемый результат: `🔕 Режим поддержки выключен`, обычный чат восстановлен.

- [ ] **Step 8: Финальный commit**

```bash
git add -A
git commit -m "feat(day33): complete support assistant with RAG + MCP CRM"
```
