# Citations & Anti-Hallucination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mandatory citations (text excerpts from retrieved chunks) and sources to every RAG answer, with a "don't know" mode when relevance is below threshold.

**Architecture:** Extend `querier.ts` with new types (`Citation`, `SourceCited`, `RagAnswerCited`), a `buildRagSystemPromptWithCitations` function that labels context blocks by chunk ID, and `ragQueryCited` that checks low-confidence before calling the LLM. Update `Chat.tsx` to use `ragQueryCited` in `ragMode` and add `/rag cite` and `/rag test cite` commands.

**Tech Stack:** TypeScript, Ink (React for terminal), Vitest for unit tests, OpenRouter API via `sendMessage`

**Spec:** `docs/superpowers/specs/2026-03-19-citations-anti-hallucination-design.md`

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `src/rag/querier.ts` | Modify | Add `Citation`, `SourceCited`, `RagAnswerCited`, `LOW_CONFIDENCE_THRESHOLD`, `buildRagSystemPromptWithCitations`, `ragQueryCited` |
| `src/rag/index.ts` | Modify | Export new symbols |
| `src/components/Chat.tsx` | Modify | Update `ragMode` block, add `/rag cite`, `/rag test cite`, update help text |
| `src/rag/querier.test.ts` | Modify | Add tests for new functions |

Files that do NOT change: `types.ts`, `reranker.ts`, `RagManager.ts`, `searcher.ts`, `embedder.ts`, `indexer.ts`, `chunker.ts`

---

## Task 1: Add types and constant to `querier.ts` (TDD)

**Files:**
- Modify: `src/rag/querier.ts`
- Test: `src/rag/querier.test.ts`

- [ ] **Step 1: Write the failing type-level test**

Add to `src/rag/querier.test.ts` after the existing imports:

```typescript
import {
  Citation,
  SourceCited,
  RagAnswerCited,
  LOW_CONFIDENCE_THRESHOLD,
} from './querier.js';

describe('Citation types and LOW_CONFIDENCE_THRESHOLD', () => {
  it('LOW_CONFIDENCE_THRESHOLD is 0.3', () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.3);
  });

  it('Citation shape is correct', () => {
    const c: Citation = {
      chunk_id: 'doc_0',
      file: 'arch.md',
      section: 'Intro',
      excerpt: 'Some text...',
    };
    expect(c.chunk_id).toBe('doc_0');
    expect(c.file).toBe('arch.md');
    expect(c.excerpt).toBe('Some text...');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npm test -- --reporter=verbose 2>&1 | grep -A5 "Citation types"
```

Expected: compile error or import error — `Citation`, `LOW_CONFIDENCE_THRESHOLD` do not exist yet.

- [ ] **Step 3: Add types and constant to `querier.ts`**

Add at the top of `src/rag/querier.ts`, after the existing interfaces (`Source`, `RagAnswer`, etc.):

```typescript
export const LOW_CONFIDENCE_THRESHOLD = 0.3;

export interface Citation {
  chunk_id: string;
  file: string;     // Chunk.file (filename only — NOT Chunk.source which is an absolute path)
  section: string;
  excerpt: string;  // first ~300 chars of chunk text
}

// Extends Source with file/chunk_id — only used in ragQueryCited.
// Existing Source interface is NOT modified.
export interface SourceCited extends Source {
  file: string;
  chunk_id: string;
}

export interface RagAnswerCited {
  answer: string;
  sources: SourceCited[];
  citations: Citation[];
  isLowConfidence: boolean;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npm test -- --reporter=verbose 2>&1 | grep -A5 "Citation types"
```

Expected: `✓ LOW_CONFIDENCE_THRESHOLD is 0.3`, `✓ Citation shape is correct`

- [ ] **Step 5: Commit**

```bash
git add src/rag/querier.ts src/rag/querier.test.ts
git commit -m "feat(rag): add Citation, SourceCited, RagAnswerCited types and LOW_CONFIDENCE_THRESHOLD"
```

---

## Task 2: Add `buildRagSystemPromptWithCitations` (TDD)

**Files:**
- Modify: `src/rag/querier.ts`
- Test: `src/rag/querier.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/rag/querier.test.ts`:

```typescript
import { buildRagSystemPromptWithCitations } from './querier.js';
import type { SearchResult } from './types.js';

describe('buildRagSystemPromptWithCitations', () => {
  it('includes [ID: chunk_id] markers for each chunk', () => {
    const results: SearchResult[] = [
      {
        score: 0.9,
        chunk: {
          chunk_id: 'arch_0',
          source: '/abs/path.md',
          file: 'arch.md',
          title: 'Architecture',
          section: 'Intro',
          strategy: 'structural',
          text: 'Clean architecture is about dependencies.',
          embedding: [],
        },
      },
      {
        score: 0.8,
        chunk: {
          chunk_id: 'arch_1',
          source: '/abs/path.md',
          file: 'arch.md',
          title: 'Architecture',
          section: 'Layers',
          strategy: 'structural',
          text: 'The domain layer has no external deps.',
          embedding: [],
        },
      },
    ];

    const prompt = buildRagSystemPromptWithCitations(results);
    expect(prompt).toContain('[ID: arch_0]');
    expect(prompt).toContain('[ID: arch_1]');
    expect(prompt).toContain('Clean architecture is about dependencies.');
    expect(prompt).toContain('The domain layer has no external deps.');
  });

  it('returns empty context block for empty results', () => {
    const prompt = buildRagSystemPromptWithCitations([]);
    expect(prompt).toContain('Контекст:');
    expect(prompt).not.toContain('[ID:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npm test -- --reporter=verbose 2>&1 | grep -A5 "buildRagSystemPromptWithCitations"
```

Expected: import error — function does not exist yet.

- [ ] **Step 3: Add `buildRagSystemPromptWithCitations` to `querier.ts`**

Add after the existing `buildRagSystemPrompt` function:

```typescript
export function buildRagSystemPromptWithCitations(results: SearchResult[]): string {
  const contextBlocks = results
    .map((r) => `[ID: ${r.chunk.chunk_id}]\n${r.chunk.text}`)
    .join('\n---\n');
  return (
    'Ты — ассистент по архитектуре ПО. Отвечай ТОЛЬКО на основе предоставленного контекста.\n' +
    'Если ответа нет в контексте — честно скажи об этом.\n' +
    'Не придумывай информацию, которой нет в источниках.\n' +
    'В ответе ссылайся на конкретные части контекста через их ID ([chunk_id]).\n\n' +
    'Контекст:\n' +
    contextBlocks
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npm test -- --reporter=verbose 2>&1 | grep -A5 "buildRagSystemPromptWithCitations"
```

Expected: `✓ includes [ID: chunk_id] markers`, `✓ returns empty context block for empty results`

- [ ] **Step 5: Commit**

```bash
git add src/rag/querier.ts src/rag/querier.test.ts
git commit -m "feat(rag): add buildRagSystemPromptWithCitations with chunk ID markers"
```

---

## Task 3: Add `ragQueryCited` (TDD)

**Files:**
- Modify: `src/rag/querier.ts`
- Test: `src/rag/querier.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/rag/querier.test.ts`. **Important:** Do NOT re-import `LOW_CONFIDENCE_THRESHOLD` (already imported in Task 1), `RagManager` (already imported at line 32 of the test file), or `SearchResult` (already imported). Only add the `ragQueryCited` symbol to the existing import from `'./querier.js'` added in Task 1.

Update the Task 1 import line from:
```typescript
import {
  Citation,
  SourceCited,
  RagAnswerCited,
  LOW_CONFIDENCE_THRESHOLD,
} from './querier.js';
```
to:
```typescript
import {
  Citation,
  SourceCited,
  RagAnswerCited,
  LOW_CONFIDENCE_THRESHOLD,
  ragQueryCited,
} from './querier.js';
```

Then add the new describe block:

```typescript
describe('ragQueryCited', () => {
  beforeEach(() => mockSendMessage.mockClear());

  it('returns isLowConfidence=true when results are empty', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([]),
    } as unknown as RagManager;

    const result = await ragQueryCited('question', mockRagManager, 'test-model');

    expect(result.isLowConfidence).toBe(true);
    expect(result.citations).toHaveLength(0);
    expect(result.sources).toHaveLength(0);
    expect(result.answer).toContain('уточните');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns isLowConfidence=true when max score is below LOW_CONFIDENCE_THRESHOLD', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([
        makeSearchResult(0.2),
        makeSearchResult(0.15),
      ]),
    } as unknown as RagManager;

    const result = await ragQueryCited('question', mockRagManager, 'test-model');

    expect(result.isLowConfidence).toBe(true);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns citations and sources when results are above threshold', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([
        makeSearchResult(0.9),
        makeSearchResult(0.8),
        makeSearchResult(0.2), // below filter threshold (0.5) — will be removed
      ]),
    } as unknown as RagManager;

    mockSendMessage.mockResolvedValueOnce({
      content: 'The answer is here.',
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      responseTime: 0.2,
    });

    const result = await ragQueryCited('test question', mockRagManager, 'test-model');

    expect(result.isLowConfidence).toBe(false);
    expect(result.answer).toBe('The answer is here.');
    // citations and sources come from filtered results (score >= 0.5 → 2 chunks)
    expect(result.citations).toHaveLength(2);
    expect(result.sources).toHaveLength(2);
    // citation excerpt is first 300 chars of chunk text
    expect(result.citations[0].chunk_id).toBe('id_0.9');
    expect(result.citations[0].file).toBe('path.md');
    expect(result.citations[0].excerpt).toContain('text 0.9');
    // source has file and chunk_id
    expect(result.sources[0].file).toBe('path.md');
    expect(result.sources[0].chunk_id).toBe('id_0.9');
  });

  it('respects custom lowConfidenceThreshold option', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([makeSearchResult(0.35)]),
    } as unknown as RagManager;

    // score 0.35 is above default 0.3 but below custom 0.4
    const result = await ragQueryCited('question', mockRagManager, 'test-model', {
      lowConfidenceThreshold: 0.4,
    });

    expect(result.isLowConfidence).toBe(true);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
```

Note: `makeSearchResult` in the existing test file builds `chunk_id: \`id_${score}\`` and `file: 'path.md'` — verify this matches the helper function in the test file before running.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npm test -- --reporter=verbose 2>&1 | grep -A5 "ragQueryCited"
```

Expected: import error — function does not exist yet.

- [ ] **Step 3: Add `ragQueryCited` to `querier.ts`**

Add after `ragQueryEnhanced`:

```typescript
export async function ragQueryCited(
  question: string,
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

  const systemPrompt = buildRagSystemPromptWithCitations(filtered);
  const apiResponse = await sendMessage(
    [{ role: 'user' as const, content: question }],
    model,
    systemPrompt,
  );

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

- [ ] **Step 4: Run all tests to verify they pass**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npm test 2>&1 | tail -20
```

Expected: all tests pass, no failures.

- [ ] **Step 5: Commit**

```bash
git add src/rag/querier.ts src/rag/querier.test.ts
git commit -m "feat(rag): add ragQueryCited with low-confidence mode and deterministic citations"
```

---

## Task 4: Update `index.ts` exports

**Files:**
- Modify: `src/rag/index.ts`

- [ ] **Step 1: Add new exports to `src/rag/index.ts`**

Add after the existing exports:

```typescript
export {
  ragQueryCited,
  buildRagSystemPromptWithCitations,
  LOW_CONFIDENCE_THRESHOLD,
} from './querier.js';
export type { Citation, SourceCited, RagAnswerCited } from './querier.js';
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Run tests to make sure nothing broke**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/rag/index.ts
git commit -m "feat(rag): export ragQueryCited, Citation, SourceCited, RagAnswerCited from index"
```

---

## Task 5: Update `ragMode` in `Chat.tsx` to use `ragQueryCited`

**Files:**
- Modify: `src/components/Chat.tsx`

- [ ] **Step 1: Add imports for new symbols**

In `src/components/Chat.tsx`, find the existing RAG imports (around line 21–32):

```typescript
import {
  RagManager,
  ragQuery,
  ragQueryEnhanced,
  loadControlQuestions,
  DEFAULT_FILTER_OPTIONS,
} from '../rag/index.js';
import type {
  RagAnswer,
  RagAnswerEnhanced,
  RagTestResult,
  ControlQuestion,
} from '../rag/index.js';
```

Replace with:

```typescript
import {
  RagManager,
  ragQuery,
  ragQueryEnhanced,
  ragQueryCited,
  loadControlQuestions,
  DEFAULT_FILTER_OPTIONS,
} from '../rag/index.js';
import type {
  RagAnswer,
  RagAnswerEnhanced,
  RagAnswerCited,
  RagTestResult,
  ControlQuestion,
} from '../rag/index.js';
```

- [ ] **Step 2: Update the `ragMode` block**

Find the `ragMode` block (around line 1938–1972):

```typescript
// RAG-режим: перехватываем сообщение и используем RAG-пайплайн
if (ragMode) {
  setIsLoading(true);
  try {
    await conversation.addUserMessage(userInput);
    setMessages(conversation.getHistory());
    const ragAnswer = await ragQuery(userInput, ragManager, currentModel);
    const sourcesBlock =
      ragAnswer.sources.length > 0
        ? '\n\n─────────────────\n📚 Источники:\n' +
          ragAnswer.sources
            .map((s) => `• ${s.title}${s.section ? ` — ${s.section}` : ''} (${s.score.toFixed(2)})`)
            .join('\n')
        : '';
    const fullAnswer = ragAnswer.answer + sourcesBlock;
    ...
```

Replace the entire `ragMode` block (lines 1938–1972) with:

```typescript
// RAG-режим: перехватываем сообщение и используем RAG-пайплайн
if (ragMode) {
  setIsLoading(true);
  try {
    await conversation.addUserMessage(userInput);
    setMessages(conversation.getHistory());
    const ragAnswer: RagAnswerCited = await ragQueryCited(userInput, ragManager, currentModel);

    let fullAnswer: string;
    if (ragAnswer.isLowConfidence) {
      fullAnswer = `⚠️ Низкая релевантность контекста.\n\n${ragAnswer.answer}`;
    } else {
      const citationsBlock =
        ragAnswer.citations.length > 0
          ? '\n\n─────────────────\n📎 Цитаты:\n' +
            ragAnswer.citations
              .map((c) => `[${c.chunk_id}] ${c.file}${c.section ? ` / ${c.section}` : ''}\n> ${c.excerpt}`)
              .join('\n\n')
          : '';
      const sourcesBlock =
        ragAnswer.sources.length > 0
          ? '\n\n─────────────────\n📚 Источники:\n' +
            ragAnswer.sources
              .map((s) => `• ${s.title}${s.section ? ` — ${s.section}` : ''} (${s.score.toFixed(2)}) [${s.chunk_id}]`)
              .join('\n')
          : '';
      fullAnswer = ragAnswer.answer + citationsBlock + sourcesBlock;
    }

    const metadata: MessageMetadata = {
      model: currentModel,
      timestamp: new Date().toISOString(),
    };
    await conversation.addAssistantMessage(fullAnswer, metadata);
    setMessages(conversation.getHistory());
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    setError(`RAG error: ${msg}`);
    setNotification(`❌ RAG ошибка: ${msg}`);
    const errorMetadata: MessageMetadata = {
      model: currentModel,
      timestamp: new Date().toISOString(),
    };
    await conversation.addAssistantMessage(`❌ Ошибка RAG: ${msg}`, errorMetadata);
    setMessages(conversation.getHistory());
  } finally {
    setIsLoading(false);
  }
  return;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): update ragMode to use ragQueryCited with citations and low-confidence mode"
```

---

## Task 6: Add `/rag cite` command

**Files:**
- Modify: `src/components/Chat.tsx`

- [ ] **Step 1: Add the `/rag cite` handler**

**Final required handler order** inside the `/rag` command block:
1. `if (args === 'test cite')` — Task 7 (add first)
2. `if (args === 'test rerank')` — existing
3. `if (args.startsWith('cite ') || args === 'cite')` — this task (add here)
4. `if (args === 'test')` — existing
5. `if (args === 'mode on')` — existing
6. ...rest of existing handlers

In `src/components/Chat.tsx`, find the `/rag` command block. After the `if (args === 'test rerank')` block (around line 1391, after the `test cite` block you added in Task 7), add the following NEW block:

```typescript
if (args.startsWith('cite ') || args === 'cite') {
  const rest = args.slice('cite'.length).trim();
  if (!rest) {
    setNotification('Использование: /rag cite <запрос> [--threshold 0.4]');
    return true;
  }

  // Parse optional --threshold flag (controls lowConfidenceThreshold, default 0.3)
  let query = rest;
  let lowConfThreshold: number | undefined;
  const thresholdMatch = rest.match(/--threshold\s+([\d.]+)/);
  if (thresholdMatch) {
    lowConfThreshold = parseFloat(thresholdMatch[1]);
    query = rest.replace(/--threshold\s+[\d.]+/, '').trim();
  }

  if (!query) {
    setNotification('Использование: /rag cite <запрос> [--threshold 0.4]');
    return true;
  }

  setNotification('⏳ Ищу с цитатами...');
  try {
    const result: RagAnswerCited = await ragQueryCited(
      query,
      ragManager,
      currentModel,
      lowConfThreshold !== undefined ? { lowConfidenceThreshold: lowConfThreshold } : undefined,
    );

    if (result.isLowConfidence) {
      setNotification(`⚠️ Низкая релевантность (порог: ${lowConfThreshold ?? 0.3})\n\n${result.answer}`);
      return true;
    }

    const citationsBlock =
      result.citations.length > 0
        ? '\n\n─────────────────\n📎 Цитаты:\n' +
          result.citations
            .map((c) => `[${c.chunk_id}] ${c.file}${c.section ? ` / ${c.section}` : ''}\n> ${c.excerpt}`)
            .join('\n\n')
        : '';
    const sourcesBlock =
      result.sources.length > 0
        ? '\n\n─────────────────\n📚 Источники:\n' +
          result.sources
            .map((s) => `• ${s.title}${s.section ? ` — ${s.section}` : ''} (${s.score.toFixed(2)}) [${s.chunk_id}]`)
            .join('\n')
        : '';

    setNotification(`🔍 "${query}"\n\n${result.answer}${citationsBlock}${sourcesBlock}`);
  } catch (err) {
    setNotification(`❌ Ошибка /rag cite: ${String(err)}`);
  }
  return true;
}
```

Place this block BEFORE the existing `if (args === 'test')` block to ensure it's checked first (since `args === 'cite'` won't accidentally match `args === 'test'`).

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): add /rag cite command with optional --threshold flag"
```

---

## Task 7: Add `/rag test cite` command and state

**Files:**
- Modify: `src/components/Chat.tsx`

- [ ] **Step 1: Add state variable for cite test mode**

Find the existing state variables (around line 237–242):

```typescript
const [ragTestMode, setRagTestMode] = useState(false);
const [ragTestIsRerank, setRagTestIsRerank] = useState(false);
```

Add after `ragTestIsRerank`:

```typescript
const [ragTestIsCite, setRagTestIsCite] = useState(false);
```

- [ ] **Step 2: Add `runRagTestStepCite` function**

Add after the existing `runRagTestStepRerank` function (around line 409):

```typescript
const runRagTestStepCite = async (questions: ControlQuestion[], step: number) => {
  if (step >= questions.length) {
    setRagTestMode(false);
    setRagTestIsCite(false);
    setNotification('✅ Тест cite завершён.');
    return;
  }
  const q = questions[step];
  setIsLoading(true);
  try {
    const result: RagAnswerCited = await ragQueryCited(q.question, ragManager, currentModel);

    const sourcesCheck = result.sources.length > 0
      ? `✅ Источники: ✓ (${result.sources.length})`
      : `❌ Источники: ✗`;
    const citationsCheck = result.citations.length > 0
      ? `✅ Цитаты: ✓ (${result.citations.length})`
      : `❌ Цитаты: ✗`;

    const citationsBlock = result.citations.length > 0
      ? '\n\n📎 Цитаты:\n' +
        result.citations
          .map((c) => `[${c.chunk_id}] ${c.file}${c.section ? ` / ${c.section}` : ''}\n> ${c.excerpt}`)
          .join('\n\n')
      : '';

    const lowConfLine = result.isLowConfidence ? '\n⚠️ Низкая релевантность' : '';

    const nextHint =
      step < questions.length - 1
        ? `\n\n─────────────────\nНажмите Enter для вопроса ${step + 2}/${questions.length}`
        : '\n\n─────────────────\nНажмите Enter для завершения теста';

    setNotification(
      `📋 Вопрос ${step + 1}/${questions.length}: ${q.question}\n\n` +
      `🤖 Ответ:\n${result.answer}\n\n` +
      `${sourcesCheck}\n${citationsCheck}${lowConfLine}` +
      citationsBlock +
      nextHint,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    setNotification(`❌ Ошибка на вопросе ${step + 1}: ${msg}`);
    setRagTestMode(false);
    setRagTestIsCite(false);
  } finally {
    setIsLoading(false);
  }
};
```

- [ ] **Step 3: Add `/rag test cite` command handler**

Find the `if (args === 'test rerank')` block and add the following BEFORE it (this makes `test cite` the first handler checked in the test group):

```typescript
if (args === 'test cite') {
  if (isLoading) {
    setNotification('⏳ Дождитесь завершения текущей операции.');
    return true;
  }
  try {
    const questions = await loadControlQuestions(
      path.resolve('rag-data', 'control-questions.json')
    );
    if (questions.length === 0) {
      setNotification('❌ Файл control-questions.json пуст.');
      return true;
    }
    setRagTestQuestions(questions);
    setRagTestResults([]);
    setRagTestStep(0);
    setRagTestMode(true);
    setRagTestIsCite(true);
    setNotification(
      `📋 Тест cite: ${questions.length} вопросов с цитатами.\n` +
      `Нажмите Enter для следующего вопроса...\n\n` +
      `Загружаю первый вопрос...`,
    );
    runRagTestStepCite(questions, 0);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    setNotification(`❌ Не удалось загрузить вопросы: ${msg}`);
  }
  return true;
}
```

- [ ] **Step 4: Update the Enter-key handler to support cite test mode**

Find the `ragTestMode` Enter handler (around line 1867–1879):

```typescript
if (ragTestMode) {
  const nextStep = ragTestStep + 1;
  setRagTestStep(nextStep);
  if (nextStep >= ragTestQuestions.length) {
    setRagTestMode(false);
    setRagTestIsRerank(false);
    setNotification('✅ Тест завершён.');
  } else if (ragTestIsRerank) {
    runRagTestStepRerank(ragTestQuestions, nextStep);
  } else {
    runRagTestStep(ragTestQuestions, nextStep);
  }
  return;
}
```

Replace with:

```typescript
if (ragTestMode) {
  const nextStep = ragTestStep + 1;
  setRagTestStep(nextStep);
  if (nextStep >= ragTestQuestions.length) {
    setRagTestMode(false);
    setRagTestIsRerank(false);
    setRagTestIsCite(false);
    setNotification('✅ Тест завершён.');
  } else if (ragTestIsCite) {
    runRagTestStepCite(ragTestQuestions, nextStep);
  } else if (ragTestIsRerank) {
    runRagTestStepRerank(ragTestQuestions, nextStep);
  } else {
    runRagTestStep(ragTestQuestions, nextStep);
  }
  return;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): add /rag test cite command with per-question citations and source verification"
```

---

## Task 8: Update help text and run all tests

**Files:**
- Modify: `src/components/Chat.tsx`

- [ ] **Step 1: Update `/rag help` text**

Find the help notification (around line 1447–1459):

```typescript
setNotification(
  'RAG команды:\n' +
  '  /rag mode on           — включить RAG-режим для всего чата\n' +
  '  /rag mode off          — выключить RAG-режим\n' +
  '  /rag test              — запустить 10 контрольных вопросов\n' +
  '  /rag index             — индексировать документы\n' +
  '  /rag <запрос>          — поиск (structural)\n' +
  '  /rag <запрос> --fixed  — поиск (fixed)\n' +
  '  /rag compare <запрос>    — сравнить стратегии\n' +
  '  /rag enhanced <запрос>  — поиск с фильтром + query rewrite\n' +
  '  /rag compare2 <запрос>  — сравнение обычного и enhanced режимов\n' +
  '  /rag test rerank        — контрольные вопросы в enhanced режиме'
);
```

Replace with:

```typescript
setNotification(
  'RAG команды:\n' +
  '  /rag mode on           — включить RAG-режим (с цитатами)\n' +
  '  /rag mode off          — выключить RAG-режим\n' +
  '  /rag cite <запрос>     — поиск с цитатами и источниками\n' +
  '  /rag cite <запрос> --threshold 0.4  — кастомный порог "не знаю"\n' +
  '  /rag test              — запустить 10 контрольных вопросов\n' +
  '  /rag test cite         — проверка 10 вопросов (источники + цитаты)\n' +
  '  /rag test rerank       — контрольные вопросы в enhanced режиме\n' +
  '  /rag index             — индексировать документы\n' +
  '  /rag <запрос>          — поиск (structural)\n' +
  '  /rag <запрос> --fixed  — поиск (fixed)\n' +
  '  /rag compare <запрос>  — сравнить стратегии\n' +
  '  /rag enhanced <запрос> — поиск с фильтром + query rewrite\n' +
  '  /rag compare2 <запрос> — сравнение обычного и enhanced режимов'
);
```

Also update the `/help` global command that lists RAG commands (search for `🔍 RAG:` around line 1640):

```
🔍 RAG:
  /rag mode on/off       — включить/выключить RAG-режим
  /rag cite <запрос>     — поиск с цитатами (--threshold 0.4 для кастомного порога)
  /rag test              — запустить 10 контрольных вопросов
  /rag test cite         — проверка источников и цитат
  /rag index             — индексировать документы
  /rag <запрос>          — поиск по базе знаний
```

- [ ] **Step 2: Run all tests**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 3: Final TypeScript check**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): update RAG help text with cite commands"
```

---

## Manual Smoke Test (after all tasks done)

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day24
npm start
```

1. `/rag index` — index documents
2. `/rag mode on` — enable RAG mode
3. Ask: `Что такое чистая архитектура?` — expect: answer + 📎 citations + 📚 sources
4. Ask: `Что такое квантовые компьютеры?` — expect: `⚠️ Низкая релевантность...`
5. `/rag mode off`
6. `/rag cite Что такое микросервисы?` — expect: citations block in notification
7. `/rag cite Что такое фотосинтез? --threshold 0.5` — expect: low confidence message
8. `/rag test cite` — press Enter through all questions, verify ✅ Источники ✓ and ✅ Цитаты ✓ on each
