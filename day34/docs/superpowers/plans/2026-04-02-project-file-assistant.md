# Project File Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `server-project.ts` MCP server giving the agent sandboxed read/write/search access to project files, demonstrated via two reproducible scenarios.

**Architecture:** New standalone MCP server `src/mcp/server-project.ts` registered in `MCPClientManager.SERVERS`. Project root configured via `PROJECT_ROOT` env var (fallback `process.cwd()`). All paths validated to stay within PROJECT_ROOT.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `zod`, Node.js `fs/promises`, `path`

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `src/mcp/server-project.ts` | MCP server with 5 project file tools |
| Modify | `src/mcp/client.ts` | Register server-project in SERVERS array |
| Modify | `.env.example` | Add PROJECT_ROOT variable |

---

## Task 1: Create `server-project.ts` with `readProjectFile` and `listProjectFiles`

**Files:**
- Create: `src/mcp/server-project.ts`

- [ ] **Step 1: Create the file with sandbox helper and first two tools**

```typescript
// src/mcp/server-project.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile, readdir, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, relative, extname } from 'path';

const server = new McpServer({ name: 'server-project', version: '1.0.0' });

const PROJECT_ROOT = resolve(process.env.PROJECT_ROOT ?? process.cwd());

/** Resolve relative path and verify it stays within PROJECT_ROOT. Throws on traversal. */
function safePath(relativePath: string): string {
  const abs = resolve(PROJECT_ROOT, relativePath);
  if (!abs.startsWith(PROJECT_ROOT + '/') && abs !== PROJECT_ROOT) {
    throw new Error(`Доступ запрещён: путь выходит за пределы проекта (${relativePath})`);
  }
  return abs;
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  '.pdf', '.zip', '.tar', '.gz', '.ico', '.woff', '.woff2', '.ttf',
]);

server.registerTool(
  'readProjectFile',
  {
    description: 'Читает содержимое файла проекта по относительному пути от PROJECT_ROOT',
    inputSchema: {
      path: z.string().describe('Относительный путь к файлу (например: src/mcp/client.ts)'),
    },
  },
  async ({ path: relPath }) => {
    try {
      const abs = safePath(relPath);
      if (!existsSync(abs)) {
        return { content: [{ type: 'text', text: `❌ Файл не найден: ${relPath}` }] };
      }
      if (BINARY_EXTENSIONS.has(extname(relPath).toLowerCase())) {
        return { content: [{ type: 'text', text: `⚠️ Бинарный файл: ${relPath} (чтение недоступно)` }] };
      }
      const content = await readFile(abs, 'utf-8');
      return { content: [{ type: 'text', text: content }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

async function globFiles(dir: string, pattern: string): Promise<string[]> {
  const results: string[] = [];
  const segments = pattern.split('/');

  async function walk(current: string, segs: string[]): Promise<void> {
    if (segs.length === 0) return;
    const [head, ...rest] = segs;

    if (head === '**') {
      // match zero or more directories
      await walk(current, rest);
      let entries: Awaited<ReturnType<typeof readdir>>;
      try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
        if (e.isDirectory()) await walk(join(current, e.name), segs);
      }
    } else if (rest.length === 0) {
      // leaf segment — match files
      let entries: Awaited<ReturnType<typeof readdir>>;
      try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
      const regex = new RegExp('^' + head.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$');
      for (const e of entries) {
        if (e.isFile() && regex.test(e.name)) {
          results.push(relative(PROJECT_ROOT, join(current, e.name)));
        }
      }
    } else {
      // directory segment
      const next = join(current, head);
      if (existsSync(next)) await walk(next, rest);
    }
  }

  await walk(dir, segments);
  return results.sort();
}

server.registerTool(
  'listProjectFiles',
  {
    description: 'Список файлов проекта по glob-паттерну (например: src/**/*.ts)',
    inputSchema: {
      glob: z.string().describe('Glob-паттерн (например: src/**/*.ts, *.json)'),
    },
  },
  async ({ glob }) => {
    try {
      const files = await globFiles(PROJECT_ROOT, glob);
      if (files.length === 0) {
        return { content: [{ type: 'text', text: `Файлы не найдены для паттерна: ${glob}` }] };
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

- [ ] **Step 2: Build and verify no TypeScript errors**

Run: `cd day34 && npm run build 2>&1 | head -30`
Expected: Build succeeds, no errors for `server-project.ts`

- [ ] **Step 3: Commit**

```bash
git add day34/src/mcp/server-project.ts
git commit -m "feat(day34): add server-project with readProjectFile and listProjectFiles"
```

---

## Task 2: Add `searchInFiles` tool

**Files:**
- Modify: `src/mcp/server-project.ts` (add tool before the transport line)

- [ ] **Step 1: Add `searchInFiles` tool**

Insert this block before the `const transport = ...` line in `src/mcp/server-project.ts`:

```typescript
server.registerTool(
  'searchInFiles',
  {
    description: 'Ищет паттерн (регулярное выражение) в файлах проекта. Возвращает файл:строка:совпадение.',
    inputSchema: {
      pattern: z.string().describe('Регулярное выражение для поиска (например: callTool|readFile)'),
      glob: z.string().describe('Glob-паттерн файлов для поиска (например: src/**/*.ts)'),
      maxResults: z.number().optional().describe('Максимальное количество совпадений (по умолчанию 50)'),
    },
  },
  async ({ pattern, glob, maxResults = 50 }) => {
    try {
      const files = await globFiles(PROJECT_ROOT, glob);
      const regex = new RegExp(pattern, 'g');
      const matches: string[] = [];

      for (const relFile of files) {
        if (matches.length >= maxResults) break;
        if (BINARY_EXTENSIONS.has(extname(relFile).toLowerCase())) continue;
        const abs = safePath(relFile);
        let content: string;
        try { content = await readFile(abs, 'utf-8'); } catch { continue; }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxResults) break;
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            matches.push(`${relFile}:${i + 1}: ${lines[i].trim()}`);
          }
        }
      }

      if (matches.length === 0) {
        return { content: [{ type: 'text', text: `Совпадений не найдено для: ${pattern}` }] };
      }
      const header = `Найдено ${matches.length} совпадений для "${pattern}":\n\n`;
      return { content: [{ type: 'text', text: header + matches.join('\n') }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);
```

- [ ] **Step 2: Build and verify**

Run: `cd day34 && npm run build 2>&1 | head -30`
Expected: Build succeeds without errors

- [ ] **Step 3: Commit**

```bash
git add day34/src/mcp/server-project.ts
git commit -m "feat(day34): add searchInFiles tool to server-project"
```

---

## Task 3: Add `writeProjectFile` and `generateDiff` tools

**Files:**
- Modify: `src/mcp/server-project.ts`

- [ ] **Step 1: Add `writeProjectFile` tool**

Insert before `const transport = ...`:

```typescript
server.registerTool(
  'writeProjectFile',
  {
    description: 'Создаёт или перезаписывает файл в проекте. Путь относительный от PROJECT_ROOT.',
    inputSchema: {
      path: z.string().describe('Относительный путь к файлу (например: output/CHANGELOG.md)'),
      content: z.string().describe('Содержимое файла'),
    },
  },
  async ({ path: relPath, content }) => {
    try {
      const abs = safePath(relPath);
      const dir = abs.substring(0, abs.lastIndexOf('/'));
      await mkdir(dir, { recursive: true });
      await writeFile(abs, content, 'utf-8');
      return { content: [{ type: 'text', text: `✅ Файл сохранён: ${relPath}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);
```

- [ ] **Step 2: Add `generateDiff` tool**

Insert after `writeProjectFile`, before `const transport = ...`:

```typescript
server.registerTool(
  'generateDiff',
  {
    description: 'Генерирует unified diff между старым и новым содержимым файла',
    inputSchema: {
      filename: z.string().describe('Имя файла (только для заголовка diff)'),
      oldContent: z.string().describe('Старое содержимое'),
      newContent: z.string().describe('Новое содержимое'),
    },
  },
  async ({ filename, oldContent, newContent }) => {
    try {
      const oldLines = oldContent.split('\n');
      const newLines = newContent.split('\n');

      if (oldContent === newContent) {
        return { content: [{ type: 'text', text: '(нет изменений)' }] };
      }

      // Simple line-by-line diff output
      const diff: string[] = [`--- a/${filename}`, `+++ b/${filename}`];
      const maxLen = Math.max(oldLines.length, newLines.length);
      let hunkStart = -1;
      const hunkLines: string[] = [];

      for (let i = 0; i < maxLen; i++) {
        const o = oldLines[i] ?? '';
        const n = newLines[i] ?? '';
        if (o !== n) {
          if (hunkStart === -1) hunkStart = i;
          if (o) hunkLines.push(`-${o}`);
          if (n) hunkLines.push(`+${n}`);
        } else {
          if (hunkLines.length > 0) {
            diff.push(`@@ -${hunkStart + 1} +${hunkStart + 1} @@`);
            diff.push(...hunkLines);
            hunkLines.length = 0;
            hunkStart = -1;
          }
        }
      }
      if (hunkLines.length > 0) {
        diff.push(`@@ -${hunkStart + 1} +${hunkStart + 1} @@`);
        diff.push(...hunkLines);
      }

      return { content: [{ type: 'text', text: diff.join('\n') }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);
```

- [ ] **Step 3: Build and verify**

Run: `cd day34 && npm run build 2>&1 | head -30`
Expected: Build succeeds without errors

- [ ] **Step 4: Commit**

```bash
git add day34/src/mcp/server-project.ts
git commit -m "feat(day34): add writeProjectFile and generateDiff tools to server-project"
```

---

## Task 4: Register server-project in MCPClientManager

**Files:**
- Modify: `src/mcp/client.ts`

- [ ] **Step 1: Add server-project to SERVERS array**

In `src/mcp/client.ts`, find the `SERVERS` array (lines 32–39) and add the new entry:

```typescript
private static readonly SERVERS: ServerConfig[] = [
  { name: 'server-web',     file: 'server-web.js' },
  { name: 'server-ai',      file: 'server-ai.js' },
  { name: 'server-files',   file: 'server-files.js' },
  { name: 'server-utils',   file: 'server-utils.js' },
  { name: 'server-git',     file: 'server-git.js' },
  { name: 'server-crm',     file: 'server-crm.js' },
  { name: 'server-project', file: 'server-project.js' },
];
```

- [ ] **Step 2: Add PROJECT_ROOT to .env.example**

In `.env.example`, add:

```
OPENROUTER_API_KEY=your_api_key_here
PROJECT_ROOT=.
```

- [ ] **Step 3: Build and verify**

Run: `cd day34 && npm run build 2>&1 | head -30`
Expected: Build succeeds without errors

- [ ] **Step 4: Commit**

```bash
git add day34/src/mcp/client.ts day34/.env.example
git commit -m "feat(day34): register server-project in MCPClientManager, add PROJECT_ROOT env"
```

---

## Task 5: Verify Demo Scenario 1 — Search API usages

**Files:** none (manual test)

- [ ] **Step 1: Start the agent**

```bash
cd day34 && npm start
```

- [ ] **Step 2: Run scenario**

Type in the agent:
```
найди все места в коде где вызывается callTool
```

- [ ] **Step 3: Verify output**

Expected: Agent calls `listProjectFiles` or `searchInFiles`, returns list of file:line matches like:
```
src/components/Chat.tsx:42: const result = await mcpClient.callTool(toolName, toolArgs);
src/mcp/client.ts:116: const result = await conn.client.callTool({ name, arguments: args });
```

---

## Task 6: Verify Demo Scenario 2 — Generate CHANGELOG

**Files:** none (manual test)

- [ ] **Step 1: Start the agent (or continue session)**

```bash
cd day34 && npm start
```

- [ ] **Step 2: Run scenario**

Type in the agent:
```
сгенерируй changelog проекта на основе README и package.json
```

- [ ] **Step 3: Verify output**

Expected:
- Agent reads `README.md` and `package.json` via `readProjectFile`
- Agent writes `output/CHANGELOG.md` via `writeProjectFile`
- File `day34/output/CHANGELOG.md` exists with meaningful content

```bash
cat day34/output/CHANGELOG.md
```
