# Design: Реранкинг и фильтрация — День 23

**Дата:** 2026-03-18
**Статус:** Approved

---

## Контекст

Агент (`day23`) уже имеет рабочий RAG-пайплайн: индексация документов → cosine-поиск → LLM-ответ. Текущая `ragQuery()` берёт топ-5 чанков без какой-либо фильтрации и отдаёт всё в LLM. Задание — добавить второй этап после поиска: фильтр релевантности по порогу cosine similarity + query rewrite + режим сравнения.

---

## Цели

1. Фильтровать нерелевантные чанки (cosine score < threshold) до передачи в LLM
2. Переписывать запрос пользователя через LLM перед поиском (query rewrite)
3. Сравнивать качество ответов: без фильтра vs с фильтром+rewrite
4. Поддержать прогон контрольных вопросов в "enhanced" режиме

---

## Архитектура

### Новый файл: `src/rag/reranker.ts`

```ts
import type { SearchResult } from './types.js';

export interface FilterOptions {
  threshold: number;   // порог cosine similarity
  topKInitial: number; // сколько брать из поиска до фильтра
  topKFinal: number;   // максимум после фильтра (слайс делает вызывающий код)
}

export const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  threshold: 0.5,
  topKInitial: 10,
  topKFinal: 5,
};

export function filterByThreshold(
  results: SearchResult[],
  threshold: number
): SearchResult[]
```

**Ответственность `filterByThreshold`:** только фильтрует по порогу. Финальный слайс до `topKFinal` делает вызывающий код.

**Edge cases:**
- Если после фильтрации массив пуст и `results.length > 0` → вернуть `[results[0]]` (топ-1 fallback)
- Если `results` пуст (`results.length === 0`) → вернуть `[]`, не обращаться к `results[0]`

---

### Изменения в `src/rag/querier.ts`

Существующая `ragQuery()` **не изменяется**.

#### `rewriteQuery(question: string, model: string): Promise<string>`

Системный промпт LLM-вызова:
```
Перефразируй запрос для семантического поиска по технической документации.
Верни только переформулированный запрос, без пояснений.
```

Использует тот же `model`, что передан в `ragQueryEnhanced`.

**Обработка ошибок:** при любой ошибке — `console.error` в stderr, вернуть оригинальный `question` (graceful fallback, не бросать исключение).

#### `RagAnswerEnhanced`

```ts
export interface RagAnswerEnhanced extends RagAnswer {
  rewrittenQuery?: string;  // undefined когда withRewrite:false;
                             // гарантированно задан когда withRewrite:true
                             // (либо результат rewrite, либо оригинал при fallback)
  chunksBeforeFilter: number;
  chunksAfterFilter: number;
}
```

Потребители должны читать `rewrittenQuery` с проверкой: `answer.rewrittenQuery ?? question`.

#### `ragQueryEnhanced`

```ts
// Внутренний тип для мержа опций
type ResolvedOptions = FilterOptions & { withFilter: boolean; withRewrite: boolean };

export async function ragQueryEnhanced(
  question: string,
  ragManager: RagManager,
  model: string,
  options: { withFilter: boolean; withRewrite: boolean } & Partial<FilterOptions>
): Promise<RagAnswerEnhanced>
```

**Pipeline:**
1. `resolvedOptions`: мержить через явный деструктуринг, избегая `undefined`-переопределений:
   ```ts
   const resolvedOptions: ResolvedOptions = {
     ...DEFAULT_FILTER_OPTIONS,
     withFilter: options.withFilter,
     withRewrite: options.withRewrite,
     ...(options.threshold !== undefined && { threshold: options.threshold }),
     ...(options.topKInitial !== undefined && { topKInitial: options.topKInitial }),
     ...(options.topKFinal !== undefined && { topKFinal: options.topKFinal }),
   };
   ```
2. Если `withRewrite` → `searchQuery = await rewriteQuery(question, model)`; иначе `searchQuery = question`
3. `results = await ragManager.search(searchQuery, 'structural', resolvedOptions.topKInitial)`
   - Стратегия `'structural'` хардкодится намеренно — не конфигурируется через `EnhancedOptions`
   - `topKInitial` явно переопределяет `RagConfig.topK` — ожидаемое поведение
4. `chunksBeforeFilter = results.length`
5. Если `withFilter` → `filtered = filterByThreshold(results, resolvedOptions.threshold)`; иначе `filtered = results`
6. `filtered = filtered.slice(0, resolvedOptions.topKFinal)`
7. `chunksAfterFilter = filtered.length`
8. `buildRagSystemPrompt(filtered)` + LLM-вызов
9. Вернуть `RagAnswerEnhanced`

---

### Изменения в `src/rag/index.ts`

```ts
export { filterByThreshold, DEFAULT_FILTER_OPTIONS } from './reranker.js';
export type { FilterOptions } from './reranker.js';
export { rewriteQuery, ragQueryEnhanced } from './querier.js';
export type { RagAnswerEnhanced } from './querier.js';
```

---

### Изменения в `src/components/Chat.tsx`

#### `/rag enhanced <запрос>`
```
ragQueryEnhanced(query, ragManager, model, {
  withFilter: true,
  withRewrite: true,
  ...DEFAULT_FILTER_OPTIONS
})
```
Вывод:
```
✏️ Rewritten: "<переписанный запрос>"
📊 Чанков: <chunksBeforeFilter> → <chunksAfterFilter> (threshold: 0.5)
🤖 Ответ: ...
📚 Источники: ...
```

#### `/rag compare2 <запрос>`
Параллельно: `ragQuery(query, ragManager, model)` + `ragQueryEnhanced({ withFilter:true, withRewrite:true })`.

Вывод **последовательный** (не side-by-side, терминал ограничен по ширине):
```
--- Без фильтра (<ragAnswer.sources.length> чанков) ---
[ответ]

--- С фильтром (<chunksBeforeFilter>→<chunksAfterFilter>, threshold=0.5) ---
Rewritten: "..."
[ответ]
```
Числа чанков берутся из `sources.length` и `chunksAfterFilter` соответственно — не хардкодятся.

#### `/rag test rerank`
Переиспользует существующий пошаговый цикл (`runRagTestStep`). Для каждого вопроса:
- Запускает только `ragQueryEnhanced({ withFilter:true, withRewrite:true, ...DEFAULT_FILTER_OPTIONS })` — без параллельного baseline `sendMessage`
- Выводит в нотификацию: вопрос, `chunksBeforeFilter→chunksAfterFilter`, ответ, источники
- Данные в `ragTestResults` не сохраняются (только в нотификации) — `RagTestResult` тип не меняется

---

## Дефолты

| Параметр | Значение | Обоснование |
|---|---|---|
| `threshold` | `0.5` | Практический порог для nomic-embed-text; релевантные чанки обычно 0.7–0.95 |
| `topKInitial` | `10` | Вдвое больше финального — даём фильтру материал для работы |
| `topKFinal` | `5` | Соответствует текущему дефолту `ragQuery` |

---

## Пошаговый план демо-видео

1. Запустить агента, показать `/help` — новые команды видны
2. `/rag index` — убедиться что индекс актуален
3. `/rag <запрос>` — обычный режим, чанки без фильтра
4. `/rag enhanced <запрос>` — тот же вопрос: видно rewrite, статистику чанков, ответ
5. `/rag compare2 <запрос>` — последовательное сравнение двух режимов в терминале
6. `/rag test rerank` — прогон контрольных вопросов со статистикой чанков

---

## Вне скоупа

- LLM-based cross-encoder reranker
- Изменение `RagConfig` / `config.json`
- Изменение существующей `ragQuery()`
- Hybrid search (BM25 + vector)
- Конфигурирование стратегии чанкинга через `EnhancedOptions`
