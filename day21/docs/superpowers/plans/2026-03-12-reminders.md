# Reminders Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в CLI-агент систему одиночных напоминаний: создание через LLM или CLI-команду, хранение в JSON, автоматическое уведомление в интерфейсе при срабатывании.

**Architecture:** `ReminderStore` читает/пишет `.reminders/data.json`. `ReminderScheduler` хранит Map таймеров в памяти и восстанавливает их при старте MCP-сервера. Четыре MCP-инструмента регистрируются в `server.ts`. `Chat.tsx` получает polling через `useEffect`/`setInterval` и обрабатывает CLI-команду `/remind`.

**Tech Stack:** TypeScript, Node.js `fs/promises`, `crypto.randomUUID()`, `setTimeout`/`clearTimeout`, MCP SDK (`@modelcontextprotocol/sdk`)

**Spec:** `docs/superpowers/specs/2026-03-12-reminders-design.md`

---

## Chunk 1: Тип + хранилище данных

### Task 1: Добавить тип Reminder в types/index.ts

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Добавить интерфейс**

Открой `src/types/index.ts`. В конец файла добавь:

```typescript
export interface Reminder {
  id: string;
  text: string;
  createdAt: string;    // ISO 8601
  scheduledAt: string;  // ISO 8601
  status: 'pending' | 'fired' | 'shown' | 'cancelled';
}
```

- [ ] **Step 2: Убедиться что компилируется**

```bash
npm run build
```

Ожидание: сборка без ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add Reminder type to types/index.ts"
```

---

### Task 2: Создать ReminderStore

**Files:**
- Create: `src/reminders/ReminderStore.ts`
- Create: `src/reminders/index.ts`

- [ ] **Step 1: Создать директорию и файл ReminderStore.ts**

```typescript
// src/reminders/ReminderStore.ts
import fs from 'fs/promises';
import path from 'path';
import { Reminder } from '../types/index.js';

const STORE_PATH = path.resolve(process.cwd(), '.reminders', 'data.json');

interface StoreData {
  reminders: Reminder[];
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
}

export async function loadReminders(): Promise<Reminder[]> {
  await ensureDir();
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf-8');
    const data: StoreData = JSON.parse(raw);
    return data.reminders ?? [];
  } catch {
    return [];
  }
}

export async function saveReminders(reminders: Reminder[]): Promise<void> {
  await ensureDir();
  await fs.writeFile(STORE_PATH, JSON.stringify({ reminders }, null, 2), 'utf-8');
}

export async function addReminder(reminder: Reminder): Promise<void> {
  const reminders = await loadReminders();
  reminders.push(reminder);
  await saveReminders(reminders);
}

export async function updateReminderStatus(
  id: string,
  status: Reminder['status']
): Promise<boolean> {
  const reminders = await loadReminders();
  const idx = reminders.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reminders[idx].status = status;
  await saveReminders(reminders);
  return true;
}

export async function getFiredReminders(): Promise<Reminder[]> {
  const reminders = await loadReminders();
  const fired = reminders.filter((r) => r.status === 'fired');

  if (fired.length === 0) return [];

  // Атомарно переводим в shown
  const updated = reminders.map((r) =>
    r.status === 'fired' ? { ...r, status: 'shown' as const } : r
  );
  await saveReminders(updated);
  return fired;
}
```

- [ ] **Step 2: Создать src/reminders/index.ts**

```typescript
// src/reminders/index.ts
export {
  loadReminders,
  saveReminders,
  addReminder,
  updateReminderStatus,
  getFiredReminders,
} from './ReminderStore.js';
export { ReminderScheduler } from './ReminderScheduler.js';
```

- [ ] **Step 3: Убедиться что компилируется**

```bash
npm run build
```

Ожидание: ошибка о `ReminderScheduler` (ещё не создан) — это нормально, исправим в следующей задаче. Остальные ошибки недопустимы.

---

## Chunk 2: Планировщик таймеров

### Task 3: Создать ReminderScheduler

**Files:**
- Create: `src/reminders/ReminderScheduler.ts`

- [ ] **Step 1: Создать файл**

```typescript
// src/reminders/ReminderScheduler.ts
import { loadReminders, saveReminders, updateReminderStatus } from './ReminderStore.js';
import { Reminder } from '../types/index.js';

export class ReminderScheduler {
  private timers: Map<string, NodeJS.Timeout> = new Map();

  /** Вызвать один раз при старте MCP-сервера */
  async initialize(): Promise<void> {
    const reminders = await loadReminders();
    const now = Date.now();

    const updated: Reminder[] = reminders.map((r) => {
      if (r.status !== 'pending') return r;

      const remaining = new Date(r.scheduledAt).getTime() - now;

      if (remaining <= 0) {
        // Уже просрочено — сразу fired
        return { ...r, status: 'fired' as const };
      }

      this.scheduleTimer(r.id, remaining);
      return r;
    });

    await saveReminders(updated);
  }

  /** Запланировать новое напоминание */
  schedule(id: string, delayMs: number): void {
    this.scheduleTimer(id, delayMs);
  }

  /** Отменить напоминание */
  cancel(id: string): boolean {
    const timer = this.timers.get(id);
    if (!timer) return false;
    clearTimeout(timer);
    this.timers.delete(id);
    return true;
  }

  private scheduleTimer(id: string, delayMs: number): void {
    const timer = setTimeout(async () => {
      this.timers.delete(id);
      await updateReminderStatus(id, 'fired');
    }, delayMs);
    // Не блокировать process.exit
    if (timer.unref) timer.unref();
    this.timers.set(id, timer);
  }
}
```

- [ ] **Step 2: Убедиться что компилируется**

```bash
npm run build
```

Ожидание: сборка без ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/reminders/
git commit -m "feat: add ReminderStore and ReminderScheduler"
```

---

## Chunk 3: MCP-инструменты

### Task 4: Добавить инструменты в server.ts и обновить имена

**Files:**
- Modify: `src/mcp/server.ts`
- Modify: `src/mcp/client.ts`

- [ ] **Step 1: Обновить имена сервера и клиента + скрыть check_fired_reminders от LLM**

В `src/mcp/server.ts` найди:
```typescript
const server = new McpServer({
  name: 'day17-local-server',
  version: '2.0.0',
});
```
Замени на:
```typescript
const server = new McpServer({
  name: 'day18-local-server',
  version: '3.0.0',
});
```

В `src/mcp/client.ts` найди:
```typescript
this.client = new Client({
  name: 'day16-cli-client',
  version: '1.0.0',
});
```
Замени на:
```typescript
this.client = new Client({
  name: 'day18-cli-client',
  version: '1.0.0',
});
```

Также в `src/mcp/client.ts` найди метод `listTools()`:
```typescript
  async listTools(): Promise<MCPTool[]> {
    if (!this.client) throw new Error('Не подключён к MCP серверу');

    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
    }));
  }
```
Замени на:
```typescript
  // Инструменты, скрытые от LLM (используются только внутренним кодом)
  private static readonly INTERNAL_TOOLS = new Set(['check_fired_reminders']);

  async listTools(): Promise<MCPTool[]> {
    if (!this.client) throw new Error('Не подключён к MCP серверу');

    const result = await this.client.listTools();
    return result.tools
      .filter((tool) => !MCPClientManager.INTERNAL_TOOLS.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
      }));
  }
```

- [ ] **Step 2: Добавить импорты в server.ts**

В начало `src/mcp/server.ts`, после существующих импортов, добавь:

```typescript
import { randomUUID } from 'crypto';
import {
  addReminder,
  loadReminders,
  updateReminderStatus,
  getFiredReminders,
  ReminderScheduler,
} from '../reminders/index.js';
import { Reminder } from '../types/index.js';
```

- [ ] **Step 3: Создать экземпляр планировщика**

После `const server = new McpServer(...)` добавь:

```typescript
const scheduler = new ReminderScheduler();
```

- [ ] **Step 4: Инициализировать планировщик при старте**

Найди в конце файла:
```typescript
const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();
```

Замени на:
```typescript
const transport = new StdioServerTransport();
(async () => {
  await scheduler.initialize();
  await server.connect(transport);
})();
```

- [ ] **Step 5: Добавить инструмент create_reminder**

После секции `// ─── Погода (wttr.in) ───...` и до финального блока добавь:

```typescript
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
  }
);

server.registerTool(
  'list_reminders',
  {
    description: 'Возвращает список всех напоминаний со статусами',
    inputSchema: {},
  },
  async () => {
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
  }
);

// Только для внутреннего использования Chat.tsx — НЕ регистрировать как публичный инструмент для LLM
// Регистрируем но не добавляем в список tools для LLM (вызывается напрямую из polling)
server.registerTool(
  'check_fired_reminders',
  {
    description: 'Возвращает напоминания которые сработали но ещё не показаны пользователю. Только для внутреннего polling.',
    inputSchema: {},
  },
  async () => {
    const fired = await getFiredReminders();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(fired),
        },
      ],
    };
  }
);
```

- [ ] **Step 6: Убедиться что компилируется**

```bash
npm run build
```

Ожидание: сборка без ошибок.

- [ ] **Step 7: Ручная проверка MCP-инструментов**

```bash
npm start
```

```
/mcp
```

Ожидание: в списке инструментов видны `create_reminder`, `list_reminders`, `cancel_reminder`. Инструмент `check_fired_reminders` в списке **не показывается** (он скрыт от LLM).

Попробуй:
```
создай напоминание через 1 минуту: "тест напоминания"
```

Ожидание: LLM вызывает `create_reminder`, отвечает с временем срабатывания.

```
/mcp call list_reminders
```

Ожидание: видишь запись со статусом `pending`.

- [ ] **Step 8: Commit**

```bash
git add src/mcp/server.ts src/mcp/client.ts
git commit -m "feat: add reminder MCP tools (create, list, cancel, check_fired)"
```

---

## Chunk 4: CLI-интеграция в Chat.tsx

### Task 5: Добавить polling и команду /remind

**Files:**
- Modify: `src/components/Chat.tsx`

- [ ] **Step 1: Добавить импорты**

В начале `Chat.tsx` найди:
```typescript
import React, { useState, useEffect } from 'react';
```
Замени на:
```typescript
import React, { useState, useEffect, useRef } from 'react';
```

Найди строку с импортами из types:
```typescript
import { Message, UsageInfo, SessionStats, MessageMetadata } from '../types/index.js';
```
Замени на:
```typescript
import { Message, UsageInfo, SessionStats, MessageMetadata, Reminder } from '../types/index.js';
```

- [ ] **Step 2: Добавить ref isPollingRef**

В блоке `useState`/`useRef` после:
```typescript
const [activeMcpTool, setActiveMcpTool] = useState<string | null>(null);
```
Добавь:
```typescript
const isPollingRef = useRef(false);
```

- [ ] **Step 3: Добавить useEffect для polling**

После последнего `useEffect` (обработчик SIGINT, строка ~1721), перед `return (`, добавь:

```typescript
  // Polling for fired reminders every 10 seconds
  useEffect(() => {
    if (!mcpManager.isConnected()) return;

    const interval = setInterval(async () => {
      if (isPollingRef.current || !mcpManager.isConnected()) return;
      isPollingRef.current = true;
      try {
        const raw = await mcpManager.callTool('check_fired_reminders', {});
        const fired: Reminder[] = JSON.parse(raw);
        if (fired.length > 0) {
          const lines = fired.map((r) => `🔔 Напоминание: ${r.text}`).join('\n');
          setNotification(lines);
        }
      } catch {
        // Игнорируем ошибки polling
      } finally {
        isPollingRef.current = false;
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [mcpManager]);
```

- [ ] **Step 4: Добавить обработчик команды /remind**

Найди блок обработки команд в `useInput` — место, где обрабатываются `/mcp`, `/strategy`, `/task` и другие команды. Найди строку вида:

```typescript
if (trimmed === '/mcp' || trimmed === '/mcp connect') {
```

Перед ней добавь обработчик `/remind`:

```typescript
    // ─── /remind ──────────────────────────────────────────────────────────
    if (trimmed === '/remind') {
      if (!mcpManager.isConnected()) {
        setNotification('❌ MCP не подключён. Сначала выполните /mcp');
        return;
      }
      try {
        const result = await mcpManager.callTool('list_reminders', {});
        setNotification(result);
      } catch (err) {
        setNotification(`❌ Ошибка: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (trimmed.startsWith('/remind cancel ')) {
      const id = trimmed.slice('/remind cancel '.length).trim();
      if (!id) {
        setNotification('Использование: /remind cancel <id>');
        return;
      }
      if (!mcpManager.isConnected()) {
        setNotification('❌ MCP не подключён. Сначала выполните /mcp');
        return;
      }
      try {
        const result = await mcpManager.callTool('cancel_reminder', { id });
        setNotification(result);
      } catch (err) {
        setNotification(`❌ Ошибка: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (trimmed.startsWith('/remind ')) {
      const args = trimmed.slice('/remind '.length).trim();
      const firstSpace = args.indexOf(' ');
      if (firstSpace === -1) {
        setNotification('Использование: /remind <минуты> <текст>\nПример: /remind 5 выпить воду');
        return;
      }
      const minutesStr = args.slice(0, firstSpace);
      const text = args.slice(firstSpace + 1).trim();
      const minutes = parseInt(minutesStr, 10);

      if (isNaN(minutes) || !Number.isInteger(minutes)) {
        setNotification('Ошибка: укажите количество минут числом');
        return;
      }
      if (minutes <= 0) {
        setNotification('Ошибка: минуты должны быть больше 0');
        return;
      }
      if (!text) {
        setNotification('Ошибка: текст напоминания не может быть пустым');
        return;
      }
      if (!mcpManager.isConnected()) {
        setNotification('❌ MCP не подключён. Сначала выполните /mcp');
        return;
      }
      try {
        const result = await mcpManager.callTool('create_reminder', { text, minutes });
        setNotification(result);
      } catch (err) {
        setNotification(`❌ Ошибка: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
```

- [ ] **Step 5: Добавить /remind в /help**

Найди в `Chat.tsx` блок с текстом помощи (`/help`). Найди секцию MCP-команд и добавь после неё:

```typescript
📅 Напоминания:
  /remind                        - список всех напоминаний
  /remind <минуты> <текст>       - создать напоминание
  /remind cancel <id>            - отменить напоминание
```

- [ ] **Step 6: Убедиться что компилируется**

```bash
npm run build
```

Ожидание: сборка без ошибок.

- [ ] **Step 7: Полная ручная проверка**

```bash
npm start
```

**Тест A — CLI-команда:**
```
/mcp
/remind 1 тест через CLI
/remind
```
Ожидание: показывает напоминание со статусом `pending` и временем через 1 минуту.

Подожди 1 минуту — должно появиться уведомление `🔔 Напоминание: тест через CLI`.

**Тест B — через LLM:**
```
напомни мне через 1 минуту размяться
```
Ожидание: LLM вызывает `create_reminder`, подтверждает создание.

**Тест C — отмена:**
```
/remind
```
Скопируй ID из вывода:
```
/remind cancel <id>
```
Ожидание: `✅ Напоминание отменено`.

**Тест D — перезапуск:**
```
/remind 2 проверка перезапуска
```
Нажми Ctrl+C, снова запусти `npm start`, выполни `/mcp`.
Ожидание: напоминание восстанавливается и сработает в назначенное время.

- [ ] **Step 8: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add /remind command and polling for fired reminders in Chat.tsx"
```

---

## Итог

После выполнения всех задач:

- `src/reminders/ReminderStore.ts` — хранилище JSON
- `src/reminders/ReminderScheduler.ts` — управление таймерами
- `src/mcp/server.ts` — 4 MCP-инструмента
- `src/components/Chat.tsx` — команда `/remind` + polling уведомлений

**Для демо** создавай напоминания на 1-2 минуты.
