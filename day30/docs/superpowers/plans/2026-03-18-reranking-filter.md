# Reranking & Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить в RAG-пайплайн фильтр релевантности по cosine threshold, query rewrite и режим сравнения через три новые команды `/rag enhanced`, `/rag compare2`, `/rag test rerank`.

**Architecture:** Новый изолированный модуль `reranker.ts` отвечает только за фильтрацию. Функция `ragQueryEnhanced` в `querier.ts` оркестрирует полный enhanced-пайплайн (rewrite → search → filter → LLM). Chat.tsx добавляет три команды, переиспользуя существующую логику test-цикла. Существующий `ragQuery` и все типы не меняются.

**Tech Stack:** TypeScript, Vitest (тесты), Ink (CLI), OpenRouter API через `sendMessage`

---

## File Map

| Действие | Файл | Что делает |
|---|---|---|
| Create | `src/rag/reranker.ts` | `filterByThreshold` + `FilterOptions` + `DEFAULT_FILTER_OPTIONS` |
| Create | `src/rag/reranker.test.ts` | Тесты для `filterByThreshold` |
| Modify | `src/rag/querier.ts` | Добавить `rewriteQuery`, `RagAnswerEnhanced`, `ragQueryEnhanced` |
| Modify | `src/rag/index.ts` | Экспортировать новые символы |
| Modify | `src/components/Chat.tsx` | Добавить `/rag enhanced`, `/rag compare2`, `/rag test rerank` |

---

## Task 1: `src/rag/reranker.ts` — фильтр по threshold

**Files:**
- Create: `src/rag/reranker.ts`
- Create: `src/rag/reranker.test.ts`

- [ ] **Step 1: Написать падающий тест**

Создать файл `day23/src/rag/reranker.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterByThreshold, DEFAULT_FILTER_OPTIONS } from './reranker.js';
import type { SearchResult } from './types.js';

function makeResult(score: number): SearchResult {
  return {
    score,
    chunk: {
      chunk_id: `id_${score}`,
      source: '/fake/path.md',
      file: 'path.md',
      title: 'Test',
      section: '',
      strategy: 'structural',
      text: `chunk score ${score}`,
      embedding: [],
    },
  };
}

describe('filterByThreshold', () => {
  it('keeps results at or above threshold', () => {
    const results = [makeResult(0.8), makeResult(0.5), makeResult(0.3)];
    const filtered = filterByThreshold(results, 0.5);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].score).toBe(0.8);
    expect(filtered[1].score).toBe(0.5);
  });

  it('returns top-1 fallback when all filtered out', () => {
    const results = [makeResult(0.8), makeResult(0.7)];
    const filtered = filterByThreshold(results, 0.9);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].score).toBe(0.8);
  });

  it('returns empty array when input is empty', () => {
    const filtered = filterByThreshold([], 0.5);
    expect(filtered).toHaveLength(0);
  });

  it('DEFAULT_FILTER_OPTIONS has expected values', () => {
    expect(DEFAULT_FILTER_OPTIONS.threshold).toBe(0.5);
    expect(DEFAULT_FILTER_OPTIONS.topKInitial).toBe(10);
    expect(DEFAULT_FILTER_OPTIONS.topKFinal).toBe(5);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
cd day23 && npm test -- src/rag/reranker.test.ts
```
Ожидаем: ошибка `Cannot find module './reranker.js'`

- [ ] **Step 3: Реализовать `src/rag/reranker.ts`**

```ts
import type { SearchResult } from './types.js';

export interface FilterOptions {
  threshold: number;
  topKInitial: number;
  topKFinal: number;
}

export const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  threshold: 0.5,
  topKInitial: 10,
  topKFinal: 5,
};

export function filterByThreshold(
  results: SearchResult[],
  threshold: number,
): SearchResult[] {
  if (results.length === 0) return [];
  const filtered = results.filter((r) => r.score >= threshold);
  if (filtered.length === 0) return [results[0]];
  return filtered;
}
```

- [ ] **Step 4: Запустить тест — убедиться что проходит**

```bash
cd day23 && npm test -- src/rag/reranker.test.ts
```
Ожидаем: 4 passed

- [ ] **Step 5: Коммит**

```bash
cd day23 && git add src/rag/reranker.ts src/rag/reranker.test.ts
git commit -m "feat(rag): add filterByThreshold with threshold filtering and top-1 fallback"
```

---

## Task 2: `rewriteQuery` в `querier.ts`

**Files:**
- Modify: `src/rag/querier.ts`

- [ ] **Step 1: Написать падающий тест**

Добавить в `day23/src/rag/reranker.test.ts` (или создать отдельный `querier.test.ts` — предпочтительно отдельный):

Создать `day23/src/rag/querier.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { rewriteQuery } from './querier.js';

// Мокируем sendMessage из ../api/openrouter.js
vi.mock('../api/openrouter.js', () => ({
  sendMessage: vi.fn(),
}));

import { sendMessage } from '../api/openrouter.js';
const mockSendMessage = vi.mocked(sendMessage);

describe('rewriteQuery', () => {
  it('returns rewritten query from LLM', async () => {
    mockSendMessage.mockResolvedValueOnce({
      content: 'что такое dependency injection',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const result = await rewriteQuery('что такое DI', 'test-model');
    expect(result).toBe('что такое dependency injection');
  });

  it('returns original question on LLM error', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('API error'));

    const result = await rewriteQuery('original question', 'test-model');
    expect(result).toBe('original question');
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
cd day23 && npm test -- src/rag/querier.test.ts
```
Ожидаем: ошибка `rewriteQuery is not exported`

- [ ] **Step 3: Добавить `rewriteQuery` в `querier.ts`**

В конец файла `src/rag/querier.ts` добавить:

```ts
export async function rewriteQuery(question: string, model: string): Promise<string> {
  const systemPrompt =
    'Перефразируй запрос для семантического поиска по технической документации.\n' +
    'Верни только переформулированный запрос, без пояснений.';
  try {
    const response = await sendMessage(
      [{ role: 'user', content: question }],
      model,
      systemPrompt,
    );
    return response.content.trim();
  } catch (err) {
    console.error('[rewriteQuery] LLM error, using original query:', err);
    return question;
  }
}
```

- [ ] **Step 4: Запустить тест — убедиться что проходит**

```bash
cd day23 && npm test -- src/rag/querier.test.ts
```
Ожидаем: 2 passed

- [ ] **Step 5: Коммит**

```bash
cd day23 && git add src/rag/querier.ts src/rag/querier.test.ts
git commit -m "feat(rag): add rewriteQuery with graceful LLM error fallback"
```

---

## Task 3: `ragQueryEnhanced` в `querier.ts`

**Files:**
- Modify: `src/rag/querier.ts`
- Modify: `src/rag/querier.test.ts`

- [ ] **Step 1: Написать падающий тест**

Добавить в `day23/src/rag/querier.test.ts` — нужно мокировать `RagManager`:

```ts
import { ragQueryEnhanced } from './querier.js';
import { DEFAULT_FILTER_OPTIONS } from './reranker.js';
import type { RagManager } from './RagManager.js';
import type { SearchResult } from './types.js';

function makeSearchResult(score: number): SearchResult {
  return {
    score,
    chunk: {
      chunk_id: `id_${score}`,
      source: '/fake/path.md',
      file: 'path.md',
      title: 'Test',
      section: 'S',
      strategy: 'structural',
      text: `text ${score}`,
      embedding: [],
    },
  };
}

describe('ragQueryEnhanced', () => {
  it('returns RagAnswerEnhanced with filter stats', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([
        makeSearchResult(0.9),
        makeSearchResult(0.8),
        makeSearchResult(0.3), // below threshold
      ]),
    } as unknown as RagManager;

    mockSendMessage.mockResolvedValueOnce({
      content: 'rewritten query',
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    });
    mockSendMessage.mockResolvedValueOnce({
      content: 'final answer',
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
    });

    const result = await ragQueryEnhanced(
      'test question',
      mockRagManager,
      'test-model',
      { withFilter: true, withRewrite: true, ...DEFAULT_FILTER_OPTIONS },
    );

    expect(result.answer).toBe('final answer');
    expect(result.rewrittenQuery).toBe('rewritten query');
    expect(result.chunksBeforeFilter).toBe(3);
    expect(result.chunksAfterFilter).toBe(2); // only scores >= 0.5
  });

  it('skips rewrite when withRewrite is false', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([makeSearchResult(0.8)]),
    } as unknown as RagManager;

    mockSendMessage.mockResolvedValueOnce({
      content: 'answer',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const result = await ragQueryEnhanced(
      'question',
      mockRagManager,
      'test-model',
      { withFilter: false, withRewrite: false },
    );

    expect(result.rewrittenQuery).toBeUndefined();
    expect(result.chunksBeforeFilter).toBe(1);
    expect(result.chunksAfterFilter).toBe(1);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

```bash
cd day23 && npm test -- src/rag/querier.test.ts
```
Ожидаем: ошибка `ragQueryEnhanced is not exported`

- [ ] **Step 3: Добавить `RagAnswerEnhanced` и `ragQueryEnhanced` в `querier.ts`**

Добавить после `rewriteQuery` в `src/rag/querier.ts`:

```ts
import { filterByThreshold, DEFAULT_FILTER_OPTIONS } from './reranker.js';
import type { FilterOptions } from './reranker.js';

export interface RagAnswerEnhanced extends RagAnswer {
  rewrittenQuery?: string;
  chunksBeforeFilter: number;
  chunksAfterFilter: number;
}

export async function ragQueryEnhanced(
  question: string,
  ragManager: RagManager,
  model: string,
  options: { withFilter: boolean; withRewrite: boolean } & Partial<FilterOptions>,
): Promise<RagAnswerEnhanced> {
  const resolved = {
    ...DEFAULT_FILTER_OPTIONS,
    withFilter: options.withFilter,
    withRewrite: options.withRewrite,
    ...(options.threshold !== undefined && { threshold: options.threshold }),
    ...(options.topKInitial !== undefined && { topKInitial: options.topKInitial }),
    ...(options.topKFinal !== undefined && { topKFinal: options.topKFinal }),
  };

  let searchQuery = question;
  let rewrittenQuery: string | undefined;

  if (resolved.withRewrite) {
    rewrittenQuery = await rewriteQuery(question, model);
    searchQuery = rewrittenQuery;
  }

  const results = await ragManager.search(searchQuery, 'structural', resolved.topKInitial);
  const chunksBeforeFilter = results.length;

  let filtered = resolved.withFilter
    ? filterByThreshold(results, resolved.threshold)
    : results;
  filtered = filtered.slice(0, resolved.topKFinal);
  const chunksAfterFilter = filtered.length;

  const systemPrompt = buildRagSystemPrompt(filtered);
  const messages = [{ role: 'user' as const, content: question }];
  const apiResponse = await sendMessage(messages, model, systemPrompt);

  const sources: Source[] = filtered.map((r) => ({
    title: r.chunk.title,
    section: r.chunk.section,
    score: r.score,
  }));

  return {
    answer: apiResponse.content,
    sources,
    rewrittenQuery,
    chunksBeforeFilter,
    chunksAfterFilter,
  };
}
```

**Важно:** импорт `filterByThreshold` и `FilterOptions` из `./reranker.js` добавить в начало файла, а не внутри функции. Убрать `import` изнутри функции, поместить его наверху файла вместе с существующими импортами.

- [ ] **Step 4: Запустить тест — убедиться что проходит**

```bash
cd day23 && npm test -- src/rag/querier.test.ts
```
Ожидаем: все тесты passed (включая тесты rewriteQuery из предыдущего таска)

- [ ] **Step 5: Коммит**

```bash
cd day23 && git add src/rag/querier.ts src/rag/querier.test.ts
git commit -m "feat(rag): add ragQueryEnhanced with filter pipeline and chunk stats"
```

---

## Task 4: Обновить `src/rag/index.ts`

**Files:**
- Modify: `src/rag/index.ts`

- [ ] **Step 1: Добавить новые экспорты**

Текущее содержимое `src/rag/index.ts`:
```ts
export { RagManager } from './RagManager.js';
export type { Chunk, IndexFile, SearchResult, RagConfig, ChunkStrategy } from './types.js';
export { ragQuery, loadControlQuestions, buildRagSystemPrompt } from './querier.js';
export type { Source, RagAnswer, ControlQuestion, RagTestResult } from './querier.js';
```

Добавить строки в конец:
```ts
export { filterByThreshold, DEFAULT_FILTER_OPTIONS } from './reranker.js';
export type { FilterOptions } from './reranker.js';
export { rewriteQuery, ragQueryEnhanced } from './querier.js';
export type { RagAnswerEnhanced } from './querier.js';
```

- [ ] **Step 2: Проверить что TypeScript компилируется без ошибок**

```bash
cd day23 && npm run build 2>&1 | head -20
```
Ожидаем: 0 errors

- [ ] **Step 3: Коммит**

```bash
cd day23 && git add src/rag/index.ts
git commit -m "feat(rag): export new reranker and enhanced querier symbols from index"
```

---

## Task 5: Новые команды в `Chat.tsx`

**Files:**
- Modify: `src/components/Chat.tsx`

Это самый большой таск — три команды. Добавляем их в существующий блок обработки `/rag` в `handleSubmit`.

- [ ] **Step 1: Добавить импорт новых символов в Chat.tsx**

Найти строку (≈ строка 20):
```ts
import { RagManager, ragQuery, loadControlQuestions } from '../rag/index.js';
import type { RagAnswer, RagTestResult, ControlQuestion } from '../rag/index.js';
```

Заменить на:
```ts
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

- [ ] **Step 2: Добавить команду `/rag enhanced`**

В блоке обработки `/rag` (≈ строка 1312) найти конструкцию с `if (trimmed.startsWith('/rag'))`. Внутри этого блока, перед строкой `/rag <query> [--fixed]` (≈ строка 1407), добавить:

```ts
// /rag enhanced <query>
if (args[0] === 'enhanced') {
  const query = args.slice(1).join(' ').trim();
  if (!query) {
    addMessage('system', 'Использование: /rag enhanced <запрос>');
    return;
  }
  setIsLoading(true);
  try {
    const result = await ragQueryEnhanced(query, ragManager, currentModel, {
      withFilter: true,
      withRewrite: true,
      ...DEFAULT_FILTER_OPTIONS,
    });
    const rewriteLine = result.rewrittenQuery
      ? `✏️ Rewritten: "${result.rewrittenQuery}"\n`
      : '';
    const statsLine = `📊 Чанков: ${result.chunksBeforeFilter} → ${result.chunksAfterFilter} (threshold: ${DEFAULT_FILTER_OPTIONS.threshold})\n`;
    const sourcesBlock =
      result.sources.length > 0
        ? '\n\n📚 Источники:\n' +
          result.sources
            .map((s) => `  • ${s.title} / ${s.section} (score: ${s.score.toFixed(3)})`)
            .join('\n')
        : '';
    addMessage('assistant', rewriteLine + statsLine + '\n' + result.answer + sourcesBlock);
  } catch (err) {
    addMessage('system', `Ошибка enhanced RAG: ${String(err)}`);
  } finally {
    setIsLoading(false);
  }
  return;
}
```

- [ ] **Step 3: Добавить команду `/rag compare2`**

Сразу после блока `enhanced`, добавить:

```ts
// /rag compare2 <query>
if (args[0] === 'compare2') {
  const query = args.slice(1).join(' ').trim();
  if (!query) {
    addMessage('system', 'Использование: /rag compare2 <запрос>');
    return;
  }
  setIsLoading(true);
  try {
    const [baseAnswer, enhancedAnswer] = await Promise.all([
      ragQuery(query, ragManager, currentModel),
      ragQueryEnhanced(query, ragManager, currentModel, {
        withFilter: true,
        withRewrite: true,
        ...DEFAULT_FILTER_OPTIONS,
      }),
    ]);
    const baseSection =
      `--- Без фильтра (${baseAnswer.sources.length} чанков) ---\n` +
      baseAnswer.answer;
    const rewriteLine = enhancedAnswer.rewrittenQuery
      ? `Rewritten: "${enhancedAnswer.rewrittenQuery}"\n`
      : '';
    const enhancedSection =
      `--- С фильтром (${enhancedAnswer.chunksBeforeFilter}→${enhancedAnswer.chunksAfterFilter}, threshold=${DEFAULT_FILTER_OPTIONS.threshold}) ---\n` +
      rewriteLine +
      enhancedAnswer.answer;
    addMessage('assistant', baseSection + '\n\n' + enhancedSection);
  } catch (err) {
    addMessage('system', `Ошибка compare2: ${String(err)}`);
  } finally {
    setIsLoading(false);
  }
  return;
}
```

- [ ] **Step 4: Добавить команду `/rag test rerank`**

В блоке `/rag test` (≈ строка 1312–1337) найти обработку `args[0] === 'test'`. Добавить проверку `args[1] === 'rerank'` в начало этого блока:

```ts
if (args[0] === 'test') {
  // /rag test rerank — enhanced mode
  if (args[1] === 'rerank') {
    setIsLoading(true);
    try {
      const questions = await loadControlQuestions(
        path.resolve('rag-data', 'control-questions.json')
      );
      setRagTestQuestions(questions);
      setRagTestResults([]);
      setRagTestStep(0);
      setRagTestMode(true);
      addMessage(
        'system',
        `🔥 RAG Rerank Test: ${questions.length} вопросов с фильтром (threshold=${DEFAULT_FILTER_OPTIONS.threshold})\nНажми Enter для следующего вопроса...`,
      );
      runRagTestStepRerank(questions, 0);
    } catch {
      addMessage('system', 'Ошибка: не найден файл control-questions.json. Запусти /rag index сначала.');
    } finally {
      setIsLoading(false);
    }
    return;
  }
  // ... существующий код /rag test
}
```

Добавить функцию `runRagTestStepRerank` рядом с существующей `runRagTestStep` (≈ строка 312):

```ts
const runRagTestStepRerank = async (questions: ControlQuestion[], step: number) => {
  if (step >= questions.length) {
    setRagTestMode(false);
    return;
  }
  const q = questions[step];
  try {
    const enhancedAnswer = await ragQueryEnhanced(q.question, ragManager, currentModel, {
      withFilter: true,
      withRewrite: true,
      ...DEFAULT_FILTER_OPTIONS,
    });
    const rewriteLine = enhancedAnswer.rewrittenQuery
      ? `✏️ Rewritten: "${enhancedAnswer.rewrittenQuery}"\n`
      : '';
    const statsLine = `📊 Чанков: ${enhancedAnswer.chunksBeforeFilter} → ${enhancedAnswer.chunksAfterFilter}\n`;
    const sourcesBlock =
      enhancedAnswer.sources.length > 0
        ? '\n📚 ' +
          enhancedAnswer.sources
            .map((s) => `${s.title} / ${s.section} (${s.score.toFixed(3)})`)
            .join(', ')
        : '';
    addMessage(
      'system',
      `[${step + 1}/${questions.length}] ${q.question}\n\n` +
        rewriteLine +
        statsLine +
        `\n🤖 ${enhancedAnswer.answer}` +
        sourcesBlock +
        `\n\n[Enter — следующий вопрос]`,
    );
  } catch (err) {
    addMessage('system', `Ошибка на вопросе ${step + 1}: ${String(err)}`);
    setRagTestMode(false);
  }
};
```

- [ ] **Step 5: Обновить `/help` текст**

Найти блок help-текста (≈ строка 1498) и добавить строки:
```
  /rag enhanced <запрос>    — поиск с фильтром + query rewrite
  /rag compare2 <запрос>    — сравнение обычного и enhanced режимов
  /rag test rerank           — контрольные вопросы в enhanced режиме
```

- [ ] **Step 6: Проверить компиляцию**

```bash
cd day23 && npm run build 2>&1 | head -30
```
Ожидаем: 0 errors

- [ ] **Step 7: Коммит**

```bash
cd day23 && git add src/components/Chat.tsx
git commit -m "feat(chat): add /rag enhanced, /rag compare2, /rag test rerank commands"
```

---

## Task 6: Финальная проверка

- [ ] **Step 1: Запустить все тесты**

```bash
cd day23 && npm test
```
Ожидаем: все тесты passed (reranker.test.ts + querier.test.ts)

- [ ] **Step 2: Запустить агента и проверить `/help`**

```bash
cd day23 && npm run dev
```
В чате набрать `/help` — убедиться что три новые команды видны в списке.

- [ ] **Step 3: Проверить `/rag enhanced` вручную**

В чате: `/rag enhanced что такое dependency injection`
Ожидаем: вывод с `✏️ Rewritten`, `📊 Чанков: 10 → N`, ответ, источники.

- [ ] **Step 4: Проверить `/rag compare2` вручную**

В чате: `/rag compare2 что такое dependency injection`
Ожидаем: два блока — без фильтра и с фильтром.

- [ ] **Step 5: Финальный коммит если нужны мелкие правки**

```bash
cd day23 && git add -p && git commit -m "fix(rag): minor fixes after manual testing"
```
