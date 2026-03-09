# MCP Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Добавить MCP клиент в CLI агент с командой `/mcp` для подключения к локальному MCP серверу и вывода списка инструментов.

**Architecture:** Локальный MCP сервер (`src/mcp/server.ts`) запускается как дочерний процесс через stdio транспорт. Клиент (`src/mcp/client.ts`) управляет соединением. Команда `/mcp` в `Chat.tsx` отображает результат.

**Tech Stack:** `@modelcontextprotocol/sdk` (уже установлен), TypeScript ESM, Node.js child_process (через StdioClientTransport)

---

### Task 1: Создать MCP сервер

**Files:**
- Create: `src/mcp/server.ts`

**Step 1: Создать файл сервера**

```typescript
// src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'day16-local-server',
  version: '1.0.0',
});

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

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Step 2: Собрать проект и проверить ошибки компиляции**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day16
npm run build
```

Ожидаемый результат: сборка завершается без ошибок, появляется `dist/mcp/server.js`.

**Step 3: Проверить что сервер запускается и не падает**

```bash
node dist/mcp/server.js
```

Ожидаемый результат: процесс запускается и ждёт stdin (не падает сразу с ошибкой). Завершить через `Ctrl+C`.

**Step 4: Зафиксировать**

```bash
git add src/mcp/server.ts
git commit -m "feat: add local MCP server with test tools"
```

---

### Task 2: Создать MCP клиент

**Files:**
- Create: `src/mcp/client.ts`
- Create: `src/mcp/index.ts`

**Step 1: Создать MCPClientManager**

```typescript
// src/mcp/client.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export class MCPClientManager {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  isConnected(): boolean {
    return this.client !== null;
  }

  async connect(): Promise<void> {
    if (this.client) return;

    const serverPath = join(__dirname, 'server.js');

    this.transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
    });

    this.client = new Client({
      name: 'day16-cli-client',
      version: '1.0.0',
    });

    await this.client.connect(this.transport);
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.client) throw new Error('Не подключён к MCP серверу');

    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
    }));
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }
}
```

**Step 2: Создать index.ts для экспортов**

```typescript
// src/mcp/index.ts
export { MCPClientManager } from './client.js';
export type { MCPTool } from './client.js';
```

**Step 3: Собрать и проверить**

```bash
npm run build
```

Ожидаемый результат: сборка без ошибок, появляются `dist/mcp/client.js` и `dist/mcp/index.js`.

**Step 4: Зафиксировать**

```bash
git add src/mcp/client.ts src/mcp/index.ts
git commit -m "feat: add MCPClientManager with connect/listTools/disconnect"
```

---

### Task 3: Интегрировать команду /mcp в Chat.tsx

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Добавить импорт MCPClientManager**

В начало файла `src/components/Chat.tsx` после строки 18 (после `import { InvariantManager ...}`):

```typescript
import { MCPClientManager } from '../mcp/index.js';
```

**Step 2: Добавить состояние mcpManager**

После строки с `invariantsLoaded` (≈ строка 223), добавить:

```typescript
const [mcpManager] = useState(() => new MCPClientManager());
```

**Step 3: Добавить обработчик /mcp**

В функции `handleCommand`, перед строкой `return false;` (≈ строка 1289), добавить:

```typescript
// MCP commands
if (trimmed === '/mcp' || trimmed === '/mcp connect') {
  setNotification('⏳ Подключение к MCP серверу...');
  try {
    await mcpManager.connect();
    const tools = await mcpManager.listTools();
    let output = `✅ MCP сервер подключён\n\nДоступные инструменты (${tools.length}):\n\n`;
    for (const tool of tools) {
      output += `🔧 ${tool.name}\n`;
      if (tool.description) {
        output += `   ${tool.description}\n`;
      }
      output += '\n';
    }
    setNotification(output.trim());
  } catch (err) {
    setNotification(`❌ Ошибка MCP: ${err instanceof Error ? err.message : String(err)}`);
  }
  return true;
}

if (trimmed === '/mcp disconnect') {
  await mcpManager.disconnect();
  setNotification('🔌 MCP отключён');
  return true;
}
```

**Step 4: Добавить /mcp в текст помощи /help**

В строках helpText найти секцию стратегий и добавить после неё:

```
📡 MCP:
  /mcp                      - подключиться и показать инструменты
  /mcp disconnect           - отключиться от сервера
```

**Step 5: Собрать проект**

```bash
npm run build
```

Ожидаемый результат: сборка без ошибок.

**Step 6: Запустить и протестировать**

```bash
npm start
```

В агенте выполнить:
```
/mcp
```

Ожидаемый результат:
```
✅ MCP сервер подключён

Доступные инструменты (3):

🔧 get_time
   Возвращает текущее дату и время

🔧 echo
   Повторяет переданное сообщение

🔧 get_agent_info
   Возвращает информацию о CLI агенте
```

**Step 7: Зафиксировать**

```bash
git add src/components/Chat.tsx
git commit -m "feat: integrate /mcp command into CLI agent"
```

---

---

### Task 4: Добавить вызов инструментов /mcp call

**Files:**
- Modify: `src/mcp/client.ts`
- Modify: `src/components/Chat.tsx`

**Step 1: Добавить метод callTool в MCPClientManager**

В `src/mcp/client.ts` добавить метод после `listTools()`:

```typescript
async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  if (!this.client) throw new Error('Не подключён к MCP серверу');

  const result = await this.client.callTool({ name, arguments: args });
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}
```

**Step 2: Добавить обработчик /mcp call в Chat.tsx**

После блока `/mcp disconnect` добавить:

```typescript
if (trimmed.startsWith('/mcp call ')) {
  const parts = trimmed.slice('/mcp call '.length).trim().split(' ');
  const toolName = parts[0];
  let args: Record<string, unknown> = {};

  // Если передан второй аргумент — парсим как JSON или как message=value
  if (parts[1]) {
    try {
      args = JSON.parse(parts.slice(1).join(' '));
    } catch {
      args = { message: parts.slice(1).join(' ') };
    }
  }

  try {
    await mcpManager.connect();
    const result = await mcpManager.callTool(toolName, args);
    setNotification(`🔧 ${toolName}:\n\n${result}`);
  } catch (err) {
    setNotification(`❌ Ошибка: ${err instanceof Error ? err.message : String(err)}`);
  }
  return true;
}
```

**Step 3: Добавить /mcp call в /help**

В helpText добавить строку в секцию MCP:

```
  /mcp call <tool> [args]   - вызвать инструмент (args: JSON или текст)
```

**Step 4: Собрать и проверить**

```bash
npm run build
npm start
```

В агенте:
```
/mcp call get_time
/mcp call echo hello world
/mcp call get_agent_info
```

Ожидаемый результат для `get_time`:
```
🔧 get_time:

09.03.2026, 15:42:10
```

**Step 5: Зафиксировать**

```bash
git add src/mcp/client.ts src/components/Chat.tsx
git commit -m "feat: add /mcp call command for tool invocation"
```

---

## Возможные проблемы

**zod не установлен** — если `import { z } from 'zod'` даёт ошибку:
```bash
npm install zod
```

**Путь к server.js** — `__dirname` в ESM нужно определять через `fileURLToPath(import.meta.url)`. Уже включено в план.

**TypeScript strict** — если `inputSchema` типизация вызывает ошибку, можно заменить `as Record<string, unknown>` на `as unknown as Record<string, unknown>`.
