# Developer Assistant — Design Spec

**Date:** 2026-03-30
**Feature:** `/ask` command — developer assistant with RAG + MCP

---

## Overview

Implement a `/ask <вопрос>` command that acts as a developer assistant for the project. It combines RAG over project documentation and MCP git tools to answer questions about the project structure, commands, and current state.

---

## Architecture

```
/ask <вопрос>
     │
     ├── RAG: search README + docs/ (top-3 chunks)
     │
     ├── MCP server-git.ts:
     │         → get_branch()   — current git branch
     │         → list_files()   — src/ file structure
     │         → get_diff()     — recent changes (git diff HEAD~1 --stat)
     │
     └── LLM request with combined context:
             system: "Ты ассистент разработчика. Используй контекст ниже."
             context: [rag_chunks] + [git_info]
             user: вопрос
```

---

## Components

### 1. `src/mcp/server-git.ts` — новый MCP сервер

Three tools:
- `get_branch()` — `git branch --show-current`
- `list_files(dir?)` — recursive file list of `src/` (excluding node_modules)
- `get_diff(n?)` — `git diff HEAD~{n} --stat`, default n=1

Registered in `config.json` alongside existing MCP servers.

### 2. RAG indexing — `for_rag/`

Files to index:
- `README.md` (copy) — all commands, project overview
- `docs/ARCHITECTURE.md` (updated to reflect current modules)
- `docs/TASK_STATE_MACHINE_GUIDE.md`

Run `/rag index` once to rebuild index. Current index (from day21) is replaced with project docs.

### 3. Updated `docs/ARCHITECTURE.md`

Current file is outdated — missing RAG, MCP, memory, invariants, profiles, skills, strategies, reminders modules. Update to reflect actual current architecture.

### 4. `/ask` command in `src/components/Chat.tsx`

```typescript
if (trimmed.startsWith('/ask ')) {
  const question = trimmed.slice(5).trim();
  if (!question) {
    setNotification('Использование: /ask <вопрос о проекте>');
    return true;
  }

  setIsLoading(true);

  // 1. RAG: search documentation
  const ragResults = await ragManager.query(question, { topK: 3 });

  // 2. MCP: git context
  if (!mcpManager.isConnected()) await mcpManager.connect();
  const branch = await mcpManager.callTool('get_branch', {});
  const files = await mcpManager.callTool('list_files', {});

  // 3. LLM with combined context
  const systemPrompt = `Ты ассистент разработчика проекта.
Документация проекта:
${ragResults}

Git ветка: ${branch}
Структура проекта:
${files}`;

  const response = await sendMessage(
    [{ role: 'user', content: question }],
    model,
    systemPrompt
  );
  addMessage('assistant', response.content);
  setIsLoading(false);
}
```

---

## Implementation Steps

1. Create `src/mcp/server-git.ts` with 3 tools
2. Register `server-git` in `config.json`
3. Update `docs/ARCHITECTURE.md` to reflect current modules
4. Copy docs to `for_rag/` and re-index (`/rag index`)
5. Add `/ask` command handler in `Chat.tsx`
6. Add `/ask` to `/help` output

---

## Success Criteria

- `/ask что такое RAG в этом проекте?` — отвечает используя документацию
- `/ask на какой ветке я работаю?` — отвечает используя git контекст
- `/ask какие команды есть?` — перечисляет команды из README
- MCP git сервер работает независимо и может быть вызван через `/mcp call get_branch`
