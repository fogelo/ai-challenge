# MCP Orchestration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Разбить монолитный MCP сервер на 4 доменных, добавить multi-server routing в MCPClientManager, и показывать атрибуцию сервера в UI (статусная строка + лог в чате).

**Architecture:** MCPClientManager запускает 4 отдельных дочерних процесса (node server-web.js, server-ai.js, server-files.js, server-utils.js), агрегирует их инструменты в единый список с полем serverName, и маршрутизирует вызовы callTool() на нужный сервер через Map<toolName, serverName>. Chat.tsx хранит отдельный массив toolCallLogs и рендерит логи вызовов в UI без добавления в историю диалога.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, Ink (React для CLI), Node.js child_process (stdio transport)

---

## Chunk 1: Создание 4 новых серверов MCP

### Task 1: Создать server-web.ts

**Files:**
- Create: `src/mcp/server-web.ts`

Содержит только инструмент `search`. Код для `fetchText` и `stripHtml` копируется из `server.ts`.

- [ ] **Step 1: Создать файл server-web.ts**

```typescript
// src/mcp/server-web.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { get as httpsGet } from 'https';
import { get as httpGet } from 'http';

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
          reject(new Error(`HTTP ${statusCode ?? 'unknown'}`)); return;
        }
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve(data));
      }).on('error', reject);
    };
    makeRequest(url, 5);
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();
}

const server = new McpServer({ name: 'server-web', version: '1.0.0' });

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

const transport = new StdioServerTransport();
(async () => { await server.connect(transport); })();
```

- [ ] **Step 2: Проверить компиляцию**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day20
npm run build 2>&1 | head -20
```

Ожидается: компиляция без ошибок.

---

### Task 2: Создать server-ai.ts

**Files:**
- Create: `src/mcp/server-ai.ts`

Содержит только инструмент `summarize`. Использует OPENROUTER_API_KEY из окружения (наследуется от родительского процесса).

- [ ] **Step 1: Создать файл server-ai.ts**

```typescript
// src/mcp/server-ai.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'server-ai', version: '1.0.0' });

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
      const userPrompt = instructions ? `${instructions}\n\nТекст:\n${text}` : `Текст:\n${text}`;
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Ты помощник для суммаризации текста. Создай краткое резюме в 3-5 предложениях.' },
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

const transport = new StdioServerTransport();
(async () => { await server.connect(transport); })();
```

- [ ] **Step 2: Проверить компиляцию**

```bash
npm run build 2>&1 | head -20
```

---

### Task 3: Создать server-files.ts

**Files:**
- Create: `src/mcp/server-files.ts`

Содержит `saveToFile`, `readFile`, `listFiles` — все операции с файлами в папке `./output/`.

- [ ] **Step 1: Создать файл server-files.ts**

```typescript
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
```

- [ ] **Step 2: Проверить компиляцию**

```bash
npm run build 2>&1 | head -20
```

---

### Task 4: Создать server-utils.ts

**Files:**
- Create: `src/mcp/server-utils.ts`

Содержит всё остальное из `server.ts`: get_time, echo, get_agent_info, git_*, get_todos, get_posts, get_user, get_weather, reminders (включая check_fired_reminders).

- [ ] **Step 1: Создать файл src/mcp/server-utils.ts**

Скопировать из `src/mcp/server.ts` всё кроме `search`, `summarize`, `saveToFile`. Изменить только имя сервера:

```typescript
// src/mcp/server-utils.ts
// Полный код из server.ts, но без search/summarize/saveToFile
// Меняем только:
const server = new McpServer({
  name: 'server-utils',  // было: 'day18-local-server'
  version: '3.0.0',
});
```

Конкретно: скопировать `server.ts` в `server-utils.ts`, изменить имя сервера на `'server-utils'`, и удалить инструменты `search`, `summarize`, `saveToFile` (и функцию `stripHtml`).

- [ ] **Step 2: Проверить компиляцию**

```bash
npm run build 2>&1 | head -30
```

Ожидается: компиляция без ошибок, 4 новых файла в `dist/mcp/`.

- [ ] **Step 3: Commit**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day20
git add src/mcp/server-web.ts src/mcp/server-ai.ts src/mcp/server-files.ts src/mcp/server-utils.ts
git commit -m "feat: split monolithic MCP server into 4 domain servers (web/ai/files/utils)"
```

---

## Chunk 2: Multi-server MCPClientManager

### Task 5: Обновить client.ts для поддержки нескольких серверов

**Files:**
- Modify: `src/mcp/client.ts`

Заменяем единственное соединение на Map<serverName, ServerConnection>. Добавляем поле `serverName` к MCPTool.

- [ ] **Step 1: Полностью заменить src/mcp/client.ts**

> **Примечание по путям:** TypeScript компилируется в `dist/`. Файл `dist/mcp/client.js` имеет `__dirname = dist/mcp/`, поэтому `join(__dirname, 'server-web.js')` корректно указывает на `dist/mcp/server-web.js`. Это та же схема, что использовалась для оригинального `server.js`. Агент всегда запускается после `npm run build`.

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
  serverName: string;
}

interface ServerConfig {
  name: string;
  file: string;
}

interface ServerConnection {
  config: ServerConfig;
  client: Client;
  transport: StdioClientTransport;
}

export class MCPClientManager {
  private connections = new Map<string, ServerConnection>();
  private toolServerMap = new Map<string, string>(); // tool name → server name

  private static readonly SERVERS: ServerConfig[] = [
    { name: 'server-web',   file: 'server-web.js' },
    { name: 'server-ai',    file: 'server-ai.js' },
    { name: 'server-files', file: 'server-files.js' },
    { name: 'server-utils', file: 'server-utils.js' },
  ];

  // Инструменты, скрытые от LLM (используются только внутренним кодом)
  private static readonly INTERNAL_TOOLS = new Set(['check_fired_reminders']);

  isConnected(): boolean {
    return this.connections.size > 0;
  }

  async connect(): Promise<void> {
    if (this.connections.size > 0) return;

    await Promise.all(
      MCPClientManager.SERVERS.map(async (config) => {
        const transport = new StdioClientTransport({
          command: 'node',
          args: [join(__dirname, config.file)],
        });
        const client = new Client({
          name: `cli-client-${config.name}`,
          version: '1.0.0',
        });
        await client.connect(transport);
        this.connections.set(config.name, { config, client, transport });
      })
    );
  }

  async listTools(): Promise<MCPTool[]> {
    if (this.connections.size === 0) throw new Error('Не подключён к MCP серверам');

    const allTools: MCPTool[] = [];
    this.toolServerMap.clear();

    for (const [serverName, conn] of this.connections) {
      const result = await conn.client.listTools();
      for (const tool of result.tools) {
        // Заполняем toolServerMap для ВСЕХ инструментов (включая internal),
        // чтобы callTool('check_fired_reminders') тоже корректно маршрутизировался.
        this.toolServerMap.set(tool.name, serverName);
        if (MCPClientManager.INTERNAL_TOOLS.has(tool.name)) continue; // скрыть от LLM
        allTools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
          serverName,
        });
      }
    }

    return allTools;
  }

  getServerForTool(name: string): string | undefined {
    return this.toolServerMap.get(name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (this.connections.size === 0) throw new Error('Не подключён к MCP серверам');

    // Найти сервер для этого инструмента
    let serverName = this.toolServerMap.get(name);

    // Если карта не заполнена — обновить
    if (!serverName) {
      await this.listTools();
      serverName = this.toolServerMap.get(name);
    }

    if (!serverName) {
      throw new Error(`Инструмент "${name}" не найден ни на одном сервере`);
    }

    const conn = this.connections.get(serverName);
    if (!conn) throw new Error(`Сервер "${serverName}" не подключён`);

    const result = await conn.client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    const textContent = content.find((c) => c.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;

    if (!textContent) throw new Error(`Инструмент "${name}" не вернул текстовый результат`);
    return textContent.text;
  }

  async disconnect(): Promise<void> {
    await Promise.all([...this.connections.values()].map((conn) => conn.client.close()));
    this.connections.clear();
    this.toolServerMap.clear();
  }
}
```

- [ ] **Step 2: Проверить компиляцию**

```bash
npm run build 2>&1 | head -30
```

Ожидается: 0 ошибок TypeScript.

- [ ] **Step 3: Быстрая ручная проверка**

Запустить агент, выполнить `/mcp` и убедиться что показываются инструменты со всех серверов:

```bash
npm start
# В агенте:
/mcp
```

Ожидается: список инструментов из всех 4 серверов (search, summarize, saveToFile, readFile, listFiles, get_time, echo, git_status, ...)

- [ ] **Step 4: Commit**

```bash
git add src/mcp/client.ts
git commit -m "feat: MCPClientManager supports multiple servers with tool routing"
```

---

## Chunk 3: Визуальная атрибуция серверов в Chat.tsx

### Task 6: Добавить toolCallLogs и обновить отображение

**Files:**
- Modify: `src/components/Chat.tsx`

Три изменения:
1. Новый state `toolCallLogs` (хранит лог вызовов только для UI)
2. В tool loop — обновлять статус + добавлять лог после каждого вызова
3. В рендере — показывать логи в чате + обновить статусный индикатор

- [ ] **Step 1: Добавить интерфейс и state для toolCallLogs**

Найти место с `const [activeMcpTool, setActiveMcpTool]` (строка ~226) и добавить ПОСЛЕ неё:

```typescript
// Существующая строка:
const [activeMcpTool, setActiveMcpTool] = useState<string | null>(null);

// Добавить:
interface ToolCallLog {
  serverName: string;
  toolName: string;
  result: string;
}
const [toolCallLogs, setToolCallLogs] = useState<ToolCallLog[]>([]);
```

- [ ] **Step 2: Обновить статусный индикатор в tool loop**

Найти строку `setActiveMcpTool(toolCall.name);` (внутри tool calling loop, ~строка 1617) и заменить:

```typescript
// Было:
setActiveMcpTool(toolCall.name);

// Стало:
const serverForTool = mcpManager.getServerForTool(toolCall.name) ?? 'unknown';
setActiveMcpTool(`[${serverForTool}] ${toolCall.name}`);
```

- [ ] **Step 3: Добавить лог после вызова инструмента**

Найти строку `loopMessages.push({ role: 'tool', ...` после `toolResult = await mcpManager.callTool(...)` и добавить ПЕРЕД ней:

```typescript
// Добавить запись в лог инструментов (только для UI, не для LLM)
const serverForLog = mcpManager.getServerForTool(toolCall.name) ?? 'unknown';
setToolCallLogs((prev) => [
  ...prev,
  {
    serverName: serverForLog,
    toolName: toolCall.name,
    result: toolResult.slice(0, 120),
  },
]);
```

- [ ] **Step 4: Очищать toolCallLogs при новом сообщении пользователя**

Найти строку `setError(null);` (в самом начале обработчика нового сообщения, ПЕРЕД `await conversation.addUserMessage(userInput)`) и добавить сразу после неё:

```typescript
setError(null);
setToolCallLogs([]); // Очистить логи ДО добавления нового сообщения пользователя
await conversation.addUserMessage(userInput);
setMessages(conversation.getHistory());
setIsLoading(true);
```

Важно: очищать ДО `setMessages`, иначе будет мигание — новое сообщение покажется вместе со старыми логами.

- [ ] **Step 5: Очищать toolCallLogs в /clear команде**

Найти обработчик `/clear` (строка ~555) и добавить `setToolCallLogs([]);` рядом с другими сбросами:

```typescript
if (trimmed === '/clear') {
  conversation.clear();
  setToolCallLogs([]); // добавить эту строку
  setSessionStats({ ... });
  // ...
```

- [ ] **Step 6: Рендерить toolCallLogs в UI**

Найти `<Box flexDirection="column" marginBottom={1}>` которая содержит `{messages.map(...)}` и `{isLoading && ...}`. Добавить рендер логов внутри той же Box, ПОСЛЕ `messages.map` и ДО `{isLoading && ...}`:

```tsx
<Box flexDirection="column" marginBottom={1}>
  {messages.map((msg, idx) => (
    <Box key={idx} marginBottom={1}>
      {/* существующий рендер */}
    </Box>
  ))}

  {/* Логи вызовов MCP инструментов — ВНУТРИ той же Box, после messages, до isLoading */}
  {toolCallLogs.map((log, idx) => (
    <Box key={`tool-log-${idx}`} marginBottom={1} flexDirection="column">
      <Box>
        <Text color="magenta">🔧 </Text>
        <Text bold color="magenta">[{log.serverName}]</Text>
        <Text color="magenta"> › {log.toolName}</Text>
      </Box>
      <Box marginLeft={3}>
        <Text dimColor>{log.result.length > 100 ? log.result.slice(0, 100) + '...' : log.result}</Text>
      </Box>
    </Box>
  ))}

  {isLoading && (
    {/* существующий loading indicator */}
  )}
</Box>
```

Критично: всё должно быть внутри одной `<Box flexDirection="column">` для правильного порядка рендера.

- [ ] **Step 7: Проверить компиляцию**

```bash
npm run build 2>&1 | head -30
```

Ожидается: 0 ошибок.

- [ ] **Step 8: Ручная проверка полного флоу**

```bash
npm start
# В агенте:
/mcp
# Затем отправить:
Скачай страницу https://docs.anthropic.com/en/home, суммаризируй на русском и сохрани в файл anthropic.md
```

Ожидается:
- Статусная строка показывает `🔧 Вызов MCP: [server-web] search...`
- Потом `🔧 Вызов MCP: [server-ai] summarize...`
- Потом `🔧 Вызов MCP: [server-files] saveToFile...`
- В чате появляются 3 лога с разными serverName

- [ ] **Step 9: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat: show server attribution in status bar and chat log for MCP tool calls"
```

---

## Chunk 4: Cleanup и документация

### Task 7: Удалить старый server.ts и обновить DEMO_MCP.md

**Files:**
- Delete: `src/mcp/server.ts`
- Modify: `DEMO_MCP.md`

- [ ] **Step 1: Удалить старый server.ts**

```bash
rm /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day20/src/mcp/server.ts
```

- [ ] **Step 2: Проверить компиляцию без server.ts**

```bash
npm run build 2>&1 | head -30
```

Ожидается: 0 ошибок (никто не импортирует server.ts напрямую).

- [ ] **Step 3: Обновить DEMO_MCP.md**

Заменить содержимое файла `DEMO_MCP.md`:

```markdown
# Demo: MCP Orchestration — Несколько серверов

## Архитектура

Агент подключается к 4 MCP серверам одновременно:

| Сервер | Инструменты |
|---|---|
| server-web | search |
| server-ai | summarize |
| server-files | saveToFile, readFile, listFiles |
| server-utils | get_time, echo, git_status, get_todos, reminders, ... |

## Запуск

\```bash
npm start
\```

## Сценарий демонстрации

### 1. Подключиться ко всем серверам

\```
/mcp
\```

**Ожидаемый результат:**
\```
✅ MCP серверы подключены (4)

server-web (1): search
server-ai (1): summarize
server-files (3): saveToFile, readFile, listFiles
server-utils (12): get_time, echo, ...
\```

---

### 2. Длинный флоу через 3 сервера

\```
Скачай страницу https://docs.anthropic.com/en/home, суммаризируй на русском и сохрани в файл anthropic.md
\```

**Что происходит:**
\```
⏳ [server-web] search...
🔧 [server-web] › search
   ✅ Anthropic is an AI safety company...

⏳ [server-ai] summarize...
🔧 [server-ai] › summarize
   ✅ Anthropic — компания по исследованию безопасности ИИ...

⏳ [server-files] saveToFile...
🔧 [server-files] › saveToFile
   ✅ Сохранено: .../output/anthropic.md
\```

Три разных сервера, три последовательных вызова, явная маршрутизация.

---

### 3. Отдельный вызов утилиты (server-utils)

\```
Какое сейчас время?
\```

\```
⏳ [server-utils] get_time...
🔧 [server-utils] › get_time
   ✅ 15 марта 2026 г., 14:30:00
\```

---

### 4. Прочитать сохранённый файл (server-files)

\```
Покажи список файлов и прочитай anthropic.md
\```

\```
🔧 [server-files] › listFiles
🔧 [server-files] › readFile
\```

---

### 5. Отключиться

\```
/mcp disconnect
\```

## Что демонстрирует

- ✅ Несколько MCP серверов зарегистрированы одновременно
- ✅ Агент выбирает правильный инструмент из правильного сервера
- ✅ Корректная маршрутизация запросов
- ✅ Длинный флоу с инструментами из разных серверов
- ✅ Визуальная атрибуция: статус + лог в чате
```

- [ ] **Step 4: Обновить /mcp команду в Chat.tsx чтобы показывала серверы**

Найти блок обработчика `/mcp` (строка ~1381) и обновить вывод списка инструментов, сгруппировав по серверам:

```typescript
if (trimmed === '/mcp' || trimmed === '/mcp connect') {
  setNotification('⏳ Подключение к MCP серверам...');
  try {
    await mcpManager.connect();
    const tools = await mcpManager.listTools();

    // Группировать инструменты по серверам
    const byServer = new Map<string, MCPTool[]>();
    for (const tool of tools) {
      const list = byServer.get(tool.serverName) ?? [];
      list.push(tool);
      byServer.set(tool.serverName, list);
    }

    let output = `✅ MCP серверы подключены (${byServer.size})\n\n`;
    for (const [serverName, serverTools] of byServer) {
      output += `📡 ${serverName} (${serverTools.length}):\n`;
      for (const tool of serverTools) {
        output += `  🔧 ${tool.name}\n`;
        if (tool.description) output += `     ${tool.description.slice(0, 60)}\n`;
      }
      output += '\n';
    }

    setIsMcpConnected(true);
    setNotification(output);
  } catch (err) {
    setNotification(`❌ Ошибка подключения: ${err instanceof Error ? err.message : String(err)}`);
  }
  return true;
}
```

- [ ] **Step 5: Финальная проверка компиляции**

```bash
npm run build 2>&1
```

Ожидается: 0 ошибок.

- [ ] **Step 6: Финальный тест полного сценария**

```bash
npm start
/mcp
# Убедиться что видны 4 сервера, сгруппированные инструменты
Скачай страницу https://docs.anthropic.com/en/home, суммаризируй на русском и сохрани в файл anthropic.md
# Убедиться что в чате видны логи [server-web], [server-ai], [server-files]
```

- [ ] **Step 7: Финальный commit**

```bash
git add src/mcp/server-utils.ts DEMO_MCP.md src/components/Chat.tsx
git rm src/mcp/server.ts
git commit -m "feat: complete MCP orchestration — 4 servers, routing, visual attribution"
```

---

## Итог

После выполнения плана:
- 4 отдельных MCP сервера с чёткими доменами
- MCPClientManager маршрутизирует вызовы к нужному серверу
- `/mcp` показывает инструменты, сгруппированные по серверам
- Статусная строка: `⏳ [server-web] search...`
- Лог в чате: `🔧 [server-web] › search ✅ ...`
- Демо-сценарий: search → summarize → saveToFile через 3 разных сервера
