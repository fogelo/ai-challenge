# Spec: Цитаты, источники и анти-галлюцинации (День 24)

## Цель

Доработать RAG-пайплайн так, чтобы каждый ответ содержал обязательные цитаты из найденных чанков и список источников, а при низкой релевантности контекста агент отвечал «не знаю».

---

## Новые типы (`src/rag/querier.ts`)

```typescript
export interface Citation {
  chunk_id: string;
  file: string;     // имя файла (maps to Chunk.file, NOT Chunk.source which is an absolute path)
  section: string;  // ближайший заголовок
  excerpt: string;  // первые ~300 символов текста чанка
}

// Расширяет существующий Source — только для ragQueryCited.
// Существующий Source интерфейс ({ title, section, score }) НЕ МЕНЯЕТСЯ.
// ragQuery и ragQueryEnhanced продолжают возвращать Source как прежде.
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

`RagAnswerCited` НЕ расширяет `RagAnswer` (чтобы не форсировать изменение `Source` интерфейса). Это изолирует изменения от существующих функций.

---

## Константы

```typescript
export const LOW_CONFIDENCE_THRESHOLD = 0.3;  // ниже — «не знаю»
```

Существующий `DEFAULT_FILTER_OPTIONS.threshold = 0.5` остаётся без изменений.

---

## Новая функция `ragQueryCited`

**Файл:** `src/rag/querier.ts`

**Сигнатура:**
```typescript
export async function ragQueryCited(
  question: string,
  ragManager: RagManager,
  model: string,
  options?: { threshold?: number; lowConfidenceThreshold?: number }
): Promise<RagAnswerCited>
```

**Пайплайн:**

1. `ragManager.search(question, 'structural', 10)` → `results`
2. Если `results` пустой или `max(scores) < lowConfidenceThreshold` (default: 0.3):
   - Вернуть `{ isLowConfidence: true, answer: "Недостаточно релевантного контекста для ответа. Пожалуйста, уточните вопрос.", citations: [], sources: [] }`
3. `filterByThreshold(results, threshold)` (default: 0.5) → `filtered`
   - Примечание: `filterByThreshold` имеет fallback — если ни один чанк не проходит 0.5, возвращает один лучший результат. Это приемлемо: такой чанк прошёл проверку low-confidence (score >= 0.3), поэтому ответ даётся, пусть и с одним слабым источником. Цитата и источник будут присутствовать.
4. `citations = filtered.map(r => ({ chunk_id: r.chunk.chunk_id, file: r.chunk.file, section: r.chunk.section, excerpt: r.chunk.text.slice(0, 300) }))`
5. `buildRagSystemPromptWithCitations(filtered)` → `systemPrompt`
6. `sendMessage([{ role: 'user', content: question }], model, systemPrompt)` → `apiResponse`
7. `sources: SourceCited[] = filtered.map(r => ({ title: r.chunk.title, section: r.chunk.section, score: r.score, file: r.chunk.file, chunk_id: r.chunk.chunk_id }))`
   - Использует `SourceCited`, а не `Source`, чтобы не трогать существующий интерфейс.
8. Вернуть `{ answer: apiResponse.content, sources, citations, isLowConfidence: false }`

---

## Новый системный промпт `buildRagSystemPromptWithCitations`

**Файл:** `src/rag/querier.ts`

**Сигнатура:**
```typescript
export function buildRagSystemPromptWithCitations(results: SearchResult[]): string
```

Промпт нумерует чанки по ID, чтобы модель могла на них ссылаться:

```
Ты — ассистент по архитектуре ПО. Отвечай ТОЛЬКО на основе предоставленного контекста.
Если ответа нет в контексте — честно скажи об этом.
Не придумывай информацию, которой нет в источниках.
В ответе ссылайся на конкретные части контекста через их ID ([chunk_id]).

Контекст:
[ID: abc_0]
...текст чанка...
---
[ID: abc_1]
...текст чанка...
```

---

## Изменения в `Chat.tsx`

### Обновление `ragMode`

- Когда `ragMode=true`, каждый обычный запрос использует `ragQueryCited` вместо `ragQuery`
- Если `isLowConfidence=true`: показать `⚠️ Низкая релевантность. [ответ]`
- Иначе рендерить:
  ```
  [ответ модели]

  📎 Цитаты:
  [chunk_id] (file / section)
  > excerpt...

  📚 Источники:
  - title / section (score: 0.85)
  ```

### Новая команда `/rag cite <запрос> [--threshold N]`

- Разовый запрос через `ragQueryCited`
- `--threshold` переопределяет `lowConfidenceThreshold` (порог "не знаю", default: 0.3)
- Примечание: `--threshold` здесь управляет `lowConfidenceThreshold`, а не filter threshold (0.5). Чтобы избежать путаницы с `ragQueryEnhanced` где `--threshold` означает filter threshold, это поведение явно задокументировано в help-тексте.
- Рендеринг: то же что и в ragMode

### Новая команда `/rag test cite`

- Загружает `rag-data/control-questions.json`
- Прогоняет каждый вопрос через `ragQueryCited`
- Для каждого вопроса показывает:
  - Вопрос
  - Ответ
  - `Источники: ✓ (N)` или `✗`
  - `Цитаты: ✓ (N)` или `✗`
  - Сами цитаты (excerpts) — для визуальной проверки что смысл ответа совпадает с источниками
  - `isLowConfidence` если применимо
- Проверка "смысл совпадает с цитатами" — **ручная/визуальная**: пользователь видит ответ и цитаты рядом и оценивает сам
- Переход по Enter, как в `/rag test`

### Обновление `/rag help`

Добавить:
```
  /rag cite <запрос>           — поиск с цитатами и источниками
  /rag cite <запрос> --threshold 0.4  — с кастомным порогом "не знаю"
  /rag test cite               — проверка 10 вопросов (источники + цитаты)
```

---

## Экспорт из `src/rag/index.ts`

Добавить экспорт:
- `ragQueryCited`
- `RagAnswerCited`
- `SourceCited`
- `Citation`
- `LOW_CONFIDENCE_THRESHOLD`
- `buildRagSystemPromptWithCitations`

---

## Файлы, которые не меняются

- `src/rag/types.ts` — типы чанков и результатов поиска не изменяются
- `src/rag/reranker.ts` — `filterByThreshold` используется как есть
- `src/rag/RagManager.ts`, `searcher.ts`, `embedder.ts`, `indexer.ts`, `chunker.ts` — без изменений

---

## Сценарий демо-видео

1. `npm start` — запуск агента
2. `/rag index` — построить индекс
3. `/rag mode on` — включить ragMode с цитатами
4. 2–3 вопроса — показать ответ + цитаты + источники
5. Нерелевантный вопрос (напр. «Что такое квантовые компьютеры?») → `⚠️ Низкая релевантность`
6. `/rag cite Что такое микросервисы? --threshold 0.35`
7. `/rag test cite` — прогон 10 вопросов, все ✓
8. `/rag mode off` — показать ответ без источников для контраста
