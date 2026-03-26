# RAG Chat with History and Task State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `ragMode` in the CLI agent so it passes full conversation history and task state into the RAG pipeline, enabling multi-turn RAG chat where the LLM retains context across all messages.

**Architecture:** Add `ragQueryWithHistory` to `querier.ts` — it searches RAG, merges the results with the `systemPromptPrefix` (task state + user profile from `buildSystemPromptWithMemory`), and calls `sendMessage` with the full conversation `messages[]` array. The `ragMode` handler in `Chat.tsx` is updated to call this new function instead of the isolated `ragQueryCited`. Existing functions and tests are untouched.

**Tech Stack:** TypeScript, Vitest, Ink (React CLI), OpenRouter API via `sendMessage`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/rag/querier.ts` | Modify | Add `ragQueryWithHistory` function + `Message` import |
| `src/rag/index.ts` | Modify | Export `ragQueryWithHistory` in the cited-functions block |
| `src/components/Chat.tsx` | Modify | Replace `ragQueryCited` with `ragQueryWithHistory` in `ragMode` handler |
| `src/rag/querier.test.ts` | Modify | Add 2 unit tests for `ragQueryWithHistory` |

---

## Task 1: Add `ragQueryWithHistory` to querier.ts (TDD)

**Files:**
- Modify: `src/rag/querier.ts`
- Test: `src/rag/querier.test.ts`

- [ ] **Step 1: Write two failing tests in `querier.test.ts`**

At the bottom of `src/rag/querier.test.ts`, add:

```typescript
import { ragQueryWithHistory } from './querier.js';
import type { Message } from '../types/index.js';

describe('ragQueryWithHistory', () => {
  beforeEach(() => mockSendMessage.mockClear());

  it('passes full message history to sendMessage', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([makeSearchResult(0.9)]),
    } as unknown as RagManager;

    mockSendMessage.mockResolvedValueOnce({
      content: 'answer with history',
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      responseTime: 0.2,
    });

    const history: Message[] = [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'follow-up question' },
    ];

    const result = await ragQueryWithHistory(
      'follow-up question',
      history,
      'Task: answer about architecture',
      mockRagManager,
      'test-model',
    );

    expect(result.isLowConfidence).toBe(false);
    expect(result.answer).toBe('answer with history');
    expect(result.sources).toHaveLength(1);
    expect(result.citations).toHaveLength(1);

    // sendMessage must receive the full history (3 messages), not just the current question
    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[0]).toHaveLength(3);
    expect(callArgs[0][0].content).toBe('first question');
  });

  it('returns isLowConfidence when max score is below threshold', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([makeSearchResult(0.2)]),
    } as unknown as RagManager;

    const history: Message[] = [{ role: 'user', content: 'question' }];

    const result = await ragQueryWithHistory(
      'question',
      history,
      '',
      mockRagManager,
      'test-model',
    );

    expect(result.isLowConfidence).toBe(true);
    expect(result.answer).toContain('уточните вопрос');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they FAIL**

```bash
cd day25 && npm test -- querier 2>&1 | tail -20
```

Expected: `ragQueryWithHistory` — FAIL with "not a function" or import error.

- [ ] **Step 3: Add `ragQueryWithHistory` to `querier.ts`**

At the top of `src/rag/querier.ts`, add the import:

```typescript
import type { Message } from '../types/index.js';
```

Then append this function at the end of the file (after `ragQueryCited`):

```typescript
export async function ragQueryWithHistory(
  question: string,
  messages: Message[],
  systemPromptPrefix: string,
  ragManager: RagManager,
  model: string,
  options?: { threshold?: number; lowConfidenceThreshold?: number },
): Promise<RagAnswerCited> {
  const lowConfThreshold = options?.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;
  const filterThreshold = options?.threshold ?? DEFAULT_FILTER_OPTIONS.threshold;

  const results = await ragManager.search(question, 'structural', 10);

  const maxScore = results.length > 0 ? Math.max(...results.map((r) => r.score)) : 0;
  if (results.length === 0 || maxScore < lowConfThreshold) {
    return {
      answer:
        'Недостаточно релевантного контекста для ответа на этот вопрос. Пожалуйста, уточните вопрос.',
      sources: [],
      citations: [],
      isLowConfidence: true,
    };
  }

  const filtered = filterByThreshold(results, filterThreshold);

  const citations: Citation[] = filtered.map((r) => ({
    chunk_id: r.chunk.chunk_id,
    file: r.chunk.file,
    section: r.chunk.section,
    excerpt: r.chunk.text.slice(0, 300),
  }));

  // Merge task state / memory prefix with RAG context.
  // rewriteQuery is intentionally omitted — matches ragQueryCited behaviour.
  const ragPrompt = buildRagSystemPromptWithCitations(filtered);
  const finalSystemPrompt = systemPromptPrefix
    ? systemPromptPrefix + '\n\n' + ragPrompt
    : ragPrompt;

  // Send FULL conversation history so LLM has multi-turn context.
  // IMPORTANT: caller must call getMessagesForAPI() *after* addUserMessage()
  // so the current user message is the last entry in messages[].
  const apiResponse = await sendMessage(messages, model, finalSystemPrompt);

  const sources: SourceCited[] = filtered.map((r) => ({
    title: r.chunk.title,
    section: r.chunk.section,
    score: r.score,
    file: r.chunk.file,
    chunk_id: r.chunk.chunk_id,
  }));

  return {
    answer: apiResponse.content,
    sources,
    citations,
    isLowConfidence: false,
  };
}
```

- [ ] **Step 4: Run tests to confirm they PASS**

```bash
cd day25 && npm test -- querier 2>&1 | tail -20
```

Expected: all querier tests PASS including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
cd day25 && git add src/rag/querier.ts src/rag/querier.test.ts
git commit -m "feat(rag): add ragQueryWithHistory for multi-turn RAG chat"
```

---

## Task 2: Export `ragQueryWithHistory` from `rag/index.ts`

**Files:**
- Modify: `src/rag/index.ts`

- [ ] **Step 1: Update the cited-functions export block**

In `src/rag/index.ts`, find the block (lines 9–14):

```typescript
export {
  ragQueryCited,
  buildRagSystemPromptWithCitations,
  LOW_CONFIDENCE_THRESHOLD,
} from './querier.js';
```

Replace with:

```typescript
export {
  ragQueryCited,
  ragQueryWithHistory,
  buildRagSystemPromptWithCitations,
  LOW_CONFIDENCE_THRESHOLD,
} from './querier.js';
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd day25 && npm run build 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd day25 && git add src/rag/index.ts
git commit -m "feat(rag): export ragQueryWithHistory from rag/index"
```

---

## Task 3: Wire `ragQueryWithHistory` into `Chat.tsx` ragMode handler

**Files:**
- Modify: `src/components/Chat.tsx`

- [ ] **Step 1: Add `ragQueryWithHistory` to the import in `Chat.tsx`**

Find the existing import block near the top of `src/components/Chat.tsx`:

```typescript
import {
  RagManager,
  ragQuery,
  ragQueryEnhanced,
  ragQueryCited,
  loadControlQuestions,
  DEFAULT_FILTER_OPTIONS,
} from '../rag/index.js';
```

Replace with:

```typescript
import {
  RagManager,
  ragQuery,
  ragQueryEnhanced,
  ragQueryCited,
  ragQueryWithHistory,
  loadControlQuestions,
  DEFAULT_FILTER_OPTIONS,
} from '../rag/index.js';
```

- [ ] **Step 2: Replace `ragQueryCited` with `ragQueryWithHistory` in the ragMode handler**

Find this code (around line 2092):

```typescript
const ragAnswer: RagAnswerCited = await ragQueryCited(userInput, ragManager, currentModel);
```

Replace with:

```typescript
// ВАЖНО: getMessagesForAPI() вызывается ПОСЛЕ addUserMessage(),
// поэтому текущее сообщение пользователя уже включено в историю.
const formattedInvariants = invariantManager.getFormattedInvariants();
const basePrompt = buildSystemPrompt(activeSkills, formattedInvariants);
const systemPrefix = conversation.buildSystemPromptWithMemory(basePrompt);
const history = await conversation.getMessagesForAPI();
const ragAnswer: RagAnswerCited = await ragQueryWithHistory(
  userInput,
  history,
  systemPrefix,
  ragManager,
  currentModel,
);
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
cd day25 && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Run all tests**

```bash
cd day25 && npm test 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd day25 && git add src/components/Chat.tsx
git commit -m "feat(chat): use ragQueryWithHistory in ragMode for multi-turn context"
```

---

## Task 4: Manual verification

**Prerequisite:** Ollama running locally with `nomic-embed-text` model, RAG index built (`/rag index`).

- [ ] **Step 1: Start the agent**

```bash
cd day25 && npm start
```

- [ ] **Step 2: Enable RAG mode**

```
/rag mode on
```

Expected output: `✅ RAG-режим включён`

- [ ] **Step 3: Run Scenario 1 — 6 messages minimum**

Send these messages one by one:

```
1. Привет, мне нужно улучшить качество ответов модели
2. У нас внутренняя база знаний на 500 документов
3. Данные обновляются каждую неделю
4. Нужно ли нам тогда файн-тюнить модель?
5. А что такое reranking и нужен ли он нам?
6. Подведи итог — что ты рекомендуешь с учётом наших ограничений?
```

**Pass criteria:**
- Каждый ответ содержит блок `📚 Источники:`
- Сообщение #6: агент упоминает "500 документов" или "обновление раз в неделю" — контекст из сообщений #2-3 сохранился

- [ ] **Step 4: Check task state**

```
/task
```

Expected: показывает текущее состояние задачи (PLANNING и описание из первого сообщения).

- [ ] **Step 5: Run Scenario 2 — 5 messages**

```
1. Какие векторные базы данных существуют?
2. У нас уже есть PostgreSQL в проде
3. Команда маленькая, 2 человека
4. Бюджет ограничен
5. Какую БД ты рекомендуешь с учётом всего вышесказанного?
```

**Pass criteria:**
- Сообщение #5: агент рекомендует pgvector (с учётом PostgreSQL из #2)
- Каждый ответ содержит источники

- [ ] **Step 6: Verify `/rag mode off` still works**

```
/rag mode off
```

Отправить любой вопрос — должен получить обычный ответ без RAG-источников.
