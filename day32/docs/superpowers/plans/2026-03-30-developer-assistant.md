# Developer Assistant (`/ask`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `/ask <вопрос>` command that answers questions about the project using RAG over docs + MCP git tools.

**Architecture:** `/ask` calls `ragManager.search()` for top-3 doc chunks, then MCP `get_branch`/`list_files` from a new `server-git.ts`, combines them into a system prompt, and calls `sendMessage` directly. Result shown as notification.

**Tech Stack:** TypeScript, MCP SDK (`@modelcontextprotocol/sdk`), execSync (child_process), existing `RagManager`, `sendMessage`, `MCPClientManager`

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Create | `src/mcp/server-git.ts` | New MCP server: `get_branch`, `list_files`, `get_diff` |
| Modify | `src/mcp/client.ts:32-37` | Add `server-git` to `SERVERS` array |
| Create | `for_rag/project-docs/README.md` | Copy of project README |
| Create | `for_rag/project-docs/ARCHITECTURE.md` | Updated architecture doc |
| Create | `for_rag/project-docs/TASK_STATE_MACHINE_GUIDE.md` | Copy of task state guide |
| Modify | `docs/ARCHITECTURE.md` | Update to reflect current modules |
| Modify | `src/components/Chat.tsx:250-252` | Change `sourcePath` to `for_rag/project-docs` |
| Modify | `src/components/Chat.tsx` | Add `/ask` command handler |
| Modify | `src/components/Chat.tsx:1731` | Add `/ask` to `/help` output |

---

## Task 1: Create `server-git.ts`

**Files:**
- Create: `src/mcp/server-git.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/mcp/server-git.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const server = new McpServer({ name: 'server-git', version: '1.0.0' });

server.registerTool(
  'get_branch',
  {
    description: 'Возвращает текущую git-ветку проекта',
    inputSchema: {},
  },
  async () => {
    try {
      const branch = execSync('git branch --show-current', {
        cwd: process.cwd(),
        encoding: 'utf-8',
      }).trim();
      return { content: [{ type: 'text', text: branch || '(detached HEAD)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

function listFilesRecursive(dir: string, rootDir: string, depth = 0): string[] {
  if (depth > 4) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const indent = '  '.repeat(depth);
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`);
      lines.push(...listFilesRecursive(full, rootDir, depth + 1));
    } else {
      lines.push(`${indent}${entry.name}`);
    }
  }
  return lines;
}

server.registerTool(
  'list_files',
  {
    description: 'Возвращает структуру файлов проекта (src/, без node_modules и dist)',
    inputSchema: {
      dir: z.string().optional().describe('Директория для листинга (по умолчанию src/)'),
    },
  },
  async ({ dir }) => {
    try {
      const targetDir = join(process.cwd(), dir ?? 'src');
      const lines = listFilesRecursive(targetDir, targetDir);
      return { content: [{ type: 'text', text: lines.join('\n') || '(пусто)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

server.registerTool(
  'get_diff',
  {
    description: 'Возвращает статистику изменений последних коммитов (git diff HEAD~n --stat)',
    inputSchema: {
      n: z.number().optional().describe('Глубина (по умолчанию 1 — последний коммит)'),
    },
  },
  async ({ n }) => {
    try {
      const depth = n ?? 1;
      const output = execSync(`git diff HEAD~${depth} --stat`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      return { content: [{ type: 'text', text: output || '(нет изменений)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

const transport = new StdioServerTransport();
(async () => { await server.connect(transport); })();
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `server-git.ts`

- [ ] **Step 3: Commit**

```bash
git add src/mcp/server-git.ts
git commit -m "feat(mcp): add server-git with get_branch, list_files, get_diff tools"
```

---

## Task 2: Register `server-git` in MCPClientManager

**Files:**
- Modify: `src/mcp/client.ts:32-37`

- [ ] **Step 1: Read current SERVERS array**

Current (lines 32-37 of `src/mcp/client.ts`):
```typescript
private static readonly SERVERS: ServerConfig[] = [
  { name: 'server-web',   file: 'server-web.js' },
  { name: 'server-ai',    file: 'server-ai.js' },
  { name: 'server-files', file: 'server-files.js' },
  { name: 'server-utils', file: 'server-utils.js' },
];
```

- [ ] **Step 2: Add server-git**

```typescript
private static readonly SERVERS: ServerConfig[] = [
  { name: 'server-web',   file: 'server-web.js' },
  { name: 'server-ai',    file: 'server-ai.js' },
  { name: 'server-files', file: 'server-files.js' },
  { name: 'server-utils', file: 'server-utils.js' },
  { name: 'server-git',   file: 'server-git.js' },
];
```

- [ ] **Step 3: Compile and verify**

```bash
cd /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/mcp/client.ts
git commit -m "feat(mcp): register server-git in MCPClientManager"
```

---

## Task 3: Update `docs/ARCHITECTURE.md`

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Rewrite the file with current architecture**

Replace the full content with:

```markdown
# Архитектура AI Агента — День 31

## Обзор

Модульный CLI-агент на TypeScript + Ink (React для терминала). Взаимодействует с LLM через OpenRouter API.

---

## Структура модулей

```
src/
├── index.tsx                    # Точка входа
├── components/
│   └── Chat.tsx                 # Основной UI (Ink), обработка всех команд
├── api/
│   └── openrouter.ts            # HTTP клиент OpenRouter API
├── chat/
│   ├── conversation.ts          # История диалога, суммаризация
│   └── session.ts               # Сохранение/загрузка сессий (.chat-history/)
├── models/
│   ├── registry.ts              # Список моделей, цены, расчёт стоимости
│   └── config.ts                # ConfigManager: config.json
├── memory/
│   └── MemoryManager.ts         # Три слоя памяти: short/working/long-term
├── profile/
│   └── ProfileManager.ts        # Профили пользователей, интервью
├── skills/
│   └── index.ts                 # Предустановленные system-prompt скиллы
├── strategies/
│   ├── SlidingWindowStrategy.ts # Последние N сообщений
│   ├── StickyFactsStrategy.ts   # Важные факты + sliding window
│   └── BranchingStrategy.ts     # Ветки диалога с чекпоинтами
├── taskstate/
│   ├── TaskStateMachine.ts      # FSM: PLANNING → EXECUTION → VALIDATION → DONE
│   └── types.ts                 # TaskState enum
├── invariants/
│   ├── InvariantStorage.ts      # Загрузка .invariants/default.json
│   ├── InvariantValidator.ts    # LLM-валидация ответов
│   ├── InvariantInjector.ts     # Форматирование в system prompt
│   └── InvariantManager.ts      # Координатор
├── mcp/
│   ├── client.ts                # MCPClientManager: подключение к серверам
│   ├── server-ai.ts             # Инструменты: summarize, classify, sentiment
│   ├── server-files.ts          # Инструменты: saveToFile, readFile, listFiles
│   ├── server-utils.ts          # Инструменты: get_time, git_status, weather, reminders
│   ├── server-web.ts            # Инструменты: fetchUrl, searchWeb
│   └── server-git.ts            # Инструменты: get_branch, list_files, get_diff
├── rag/
│   ├── RagManager.ts            # Координатор: index, search, compare
│   ├── indexer.ts               # Сборка индекса из .md файлов + эмбеддинги
│   ├── chunker.ts               # Разбивка на чанки: fixed / structural
│   ├── embedder.ts              # Ollama embeddings (nomic-embed-text)
│   ├── searcher.ts              # Косинусное сходство
│   ├── reranker.ts              # Фильтрация по threshold
│   ├── querier.ts               # ragQuery, ragQueryEnhanced, ragQueryCited
│   └── types.ts                 # Chunk, SearchResult, RagConfig
├── reminders/
│   └── index.ts                 # Напоминания с таймером
├── utils/
│   └── tokens.ts                # Подсчёт токенов
└── types/
    └── index.ts                 # Общие TypeScript типы
```

---

## Команды агента

| Команда | Описание |
|---------|----------|
| `/model` | Переключение модели |
| `/clear` | Очистка контекста |
| `/compact` | Ручная суммаризация |
| `/stats` | Метрики запросов |
| `/resume` | Загрузка сессии |
| `/task` | Task State Machine |
| `/next` | Следующий этап задачи |
| `/profile` | Управление профилями |
| `/skills` | Активация скиллов |
| `/strategy` | Переключение стратегии |
| `/invariants` | Инварианты проекта |
| `/mcp` | MCP инструменты |
| `/rag` | RAG поиск по документации |
| `/ask` | Developer assistant (RAG + git) |
| `/remind` | Напоминания |
| `/memory` | Просмотр памяти |

---

## Поток данных

```
Пользователь → Chat.tsx
  ├── Команда (/xxx) → handleCommand()
  └── Обычное сообщение → conversation.addUserMessage()
                           → sendMessage() → OpenRouter API
                           → conversation.addAssistantMessage()
```

---

## RAG Pipeline

```
/rag index → for_rag/ → chunker → embedder (Ollama) → rag-data/index-*.json
/ask <вопрос> → ragManager.search() → top-3 chunks
              + MCP get_branch/list_files
              → system prompt с контекстом
              → sendMessage() → ответ
```

---

## MCP Architecture

Каждый MCP сервер — отдельный Node.js процесс, общение через stdio.
`MCPClientManager` запускает все серверы при `/mcp connect`.
```

- [ ] **Step 2: Verify file was written correctly**

Read the first 10 lines to confirm:
```bash
head -10 /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31/docs/ARCHITECTURE.md
```

Expected: `# Архитектура AI Агента — День 31`

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: update ARCHITECTURE.md to reflect current day31 modules"
```

---

## Task 4: Populate `for_rag/project-docs/`

**Files:**
- Create: `for_rag/project-docs/README.md`
- Create: `for_rag/project-docs/ARCHITECTURE.md`
- Create: `for_rag/project-docs/TASK_STATE_MACHINE_GUIDE.md`

- [ ] **Step 1: Create directory and copy files**

```bash
mkdir -p /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31/for_rag/project-docs
cp /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31/README.md \
   /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31/for_rag/project-docs/README.md
cp /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31/docs/ARCHITECTURE.md \
   /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31/for_rag/project-docs/ARCHITECTURE.md
cp /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31/docs/TASK_STATE_MACHINE_GUIDE.md \
   /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31/for_rag/project-docs/TASK_STATE_MACHINE_GUIDE.md
```

- [ ] **Step 2: Verify files exist**

```bash
ls /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31/for_rag/project-docs/
```

Expected:
```
ARCHITECTURE.md
README.md
TASK_STATE_MACHINE_GUIDE.md
```

- [ ] **Step 3: Commit**

```bash
git add for_rag/project-docs/
git commit -m "docs(rag): add project-docs to for_rag for developer assistant indexing"
```

---

## Task 5: Update RAG sourcePath in Chat.tsx

**Files:**
- Modify: `src/components/Chat.tsx:250-252`

- [ ] **Step 1: Find current initialization**

Line ~250-253 in `src/components/Chat.tsx`:
```typescript
const [ragManager] = useState(() => new RagManager({
  sourcePath: path.resolve('for_rag/Архитектура'),
  outputPath: path.resolve('rag-data'),
```

- [ ] **Step 2: Change sourcePath**

```typescript
const [ragManager] = useState(() => new RagManager({
  sourcePath: path.resolve('for_rag/project-docs'),
  outputPath: path.resolve('rag-data'),
```

- [ ] **Step 3: Compile check**

```bash
cd /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(rag): point RAG sourcePath to for_rag/project-docs"
```

---

## Task 6: Add `/ask` command handler to Chat.tsx

**Files:**
- Modify: `src/components/Chat.tsx` — add handler before `/rag` block (line ~1414)

- [ ] **Step 1: Find the insertion point**

Find line `// RAG commands` in `Chat.tsx` (around line 1414). Insert `/ask` handler just before it.

- [ ] **Step 2: Add the handler**

Insert before `// RAG commands`:

```typescript
// Ask command — developer assistant (RAG + MCP git)
if (trimmed.startsWith('/ask ') || trimmed === '/ask') {
  const question = trimmed.slice(5).trim();
  if (!question) {
    setNotification('Использование: /ask <вопрос о проекте>\nПример: /ask какие команды есть?');
    return true;
  }

  setIsLoading(true);
  try {
    // 1. RAG: search project docs
    let ragContext = '';
    try {
      const ragResults = await ragManager.search(question, 'structural', 3);
      if (ragResults.length > 0) {
        ragContext = ragResults.map((r) => r.chunk.text).join('\n---\n');
      }
    } catch {
      ragContext = '(документация не проиндексирована — запустите /rag index)';
    }

    // 2. MCP: git context
    let gitBranch = '';
    let gitFiles = '';
    try {
      if (!mcpManager.isConnected()) await mcpManager.connect();
      gitBranch = await mcpManager.callTool('get_branch', {});
      gitFiles = await mcpManager.callTool('list_files', {});
    } catch {
      gitBranch = '(MCP недоступен)';
    }

    // 3. LLM with combined context
    const systemPrompt =
      'Ты ассистент разработчика. Отвечай на вопросы о проекте на основе документации и контекста ниже.\n' +
      'Если информации нет — честно скажи об этом.\n\n' +
      'Документация проекта:\n' + ragContext +
      '\n\nТекущая git-ветка: ' + gitBranch +
      '\n\nСтруктура src/:\n' + gitFiles;

    const apiResponse = await sendMessage(
      [{ role: 'user', content: question }],
      currentModel,
      systemPrompt,
    );

    setNotification(`🤖 Developer Assistant:\n\n${apiResponse.content}`);
  } catch (err) {
    setNotification(`❌ Ошибка /ask: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setIsLoading(false);
  }
  return true;
}
```

- [ ] **Step 3: Compile check**

```bash
cd /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): add /ask developer assistant command with RAG + MCP git context"
```

---

## Task 7: Add `/ask` to `/help` output

**Files:**
- Modify: `src/components/Chat.tsx` — `/help` section (~line 1780)

- [ ] **Step 1: Find the RAG section in /help output**

In the `/help` block, find the line:
```
🔍 RAG:
```

- [ ] **Step 2: Add `/ask` entry before the RAG section**

Insert before `🔍 RAG:`:

```
🤖 Developer Assistant:
  /ask <вопрос>          — спросить о проекте (RAG + git контекст)

```

- [ ] **Step 3: Compile and full build**

```bash
cd /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31
npm run build 2>&1 | tail -20
```

Expected: build succeeds, `dist/` updated

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "docs(chat): add /ask to /help output"
```

---

## Task 8: Build, index, and smoke-test

- [ ] **Step 1: Full build**

```bash
cd /Users/antor/Desktop/learn/gladkov-challenge/ai-challenge/day31
npm run build 2>&1 | tail -10
```

Expected: `dist/` updated without errors

- [ ] **Step 2: Start the agent and index**

```bash
npm start
```

In the agent, run:
```
/rag index
```

Expected: `✅ Индексирование завершено` with chunk count > 0

- [ ] **Step 3: Test MCP git tools**

```
/mcp
/mcp call get_branch
/mcp call list_files
```

Expected:
- `get_branch` returns branch name (e.g. `master`)
- `list_files` returns `src/` tree

- [ ] **Step 4: Test `/ask`**

```
/ask какие команды есть в этом агенте?
/ask на какой ветке я работаю?
/ask что такое Task State Machine?
```

Expected: each question returns a relevant answer using project context

- [ ] **Step 5: Commit if all works**

```bash
git add -A
git commit -m "feat(day31): complete developer assistant - /ask with RAG + MCP git"
```
