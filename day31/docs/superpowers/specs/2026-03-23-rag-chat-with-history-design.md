# Спецификация: RAG-чат с историей диалога и памятью задачи

**Дата:** 2026-03-23
**День курса:** Day 25
**Статус:** Approved

---

## Контекст

День 25 — финал недели RAG. Задание: мини-чат (CLI), который:
- хранит историю диалога
- при каждом вопросе ищет контекст через RAG
- отвечает с учётом найденной информации
- всегда выводит источники
- имеет "память задачи" (task state): цель, уточнения, ограничения

### Текущее состояние

Агент уже реализован и включает:
- `Conversation` — управление историей диалога
- `RagManager` + `ragQueryCited` — поиск с источниками и цитатами
- `TaskStateMachine` — PLANNING/EXECUTION/VALIDATION/DONE с инъекцией в system prompt
- `buildSystemPromptWithMemory()` — сборка промпта с профилем + task state + памятью
- `/rag mode on` — режим RAG для всех сообщений

### Проблема

В `ragMode` handler вызывается `ragQueryCited(userInput, ...)`, которая отправляет в LLM **только текущий вопрос** — без истории диалога и без task state. На сообщении #5+ агент теряет контекст предыдущих сообщений.

---

## Решение

### Подход

Добавить новую функцию `ragQueryWithHistory` в `querier.ts`, которая принимает полную историю диалога и системный промпт с task state. Изменить ragMode handler в `Chat.tsx` для её использования.

Существующий код не трогаем: функция `ragQueryCited`, handler `/rag cite` в Chat.tsx, файл `reranker.test.ts`, существующие тесты в `querier.test.ts`. Меняется только ragMode handler в Chat.tsx, добавляются новые тесты в `querier.test.ts`.

---

## Архитектура изменений

```
querier.ts — новая функция ragQueryWithHistory
│
├── Принимает: question, messages[], systemPromptPrefix, ragManager, model
├── ragManager.search(question) → RAG chunks
├── buildRagSystemPromptWithCitations(filtered) → RAG system prompt
├── systemPromptPrefix + '\n\n' + ragPrompt → итоговый system prompt
├── sendMessage(messages, model, finalSystemPrompt) → история + контекст
└── Возвращает: RagAnswerCited (тот же тип, UI не меняется)

Chat.tsx — изменение ragMode handler
│
├── systemPrefix = conversation.buildSystemPromptWithMemory()
├── history = await conversation.getMessagesForAPI()
└── ragQueryWithHistory(question, history, systemPrefix, ragManager, model)
```

---

## Детали реализации

### 1. `querier.ts` — новая функция

**Дополнительный импорт** (добавить в начало файла):
```typescript
import type { Message } from '../types/index.js';
```

**Примечание:** функция использует `ragManager.search(question)` без `rewriteQuery` — это намеренно, для соответствия поведению `ragQueryCited`. Логика с rewrite есть только в `ragQueryEnhanced`.

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

  const maxScore = results.length > 0 ? Math.max(...results.map(r => r.score)) : 0;
  if (results.length === 0 || maxScore < lowConfThreshold) {
    return {
      answer: 'Недостаточно релевантного контекста для ответа на этот вопрос. Пожалуйста, уточните вопрос.',
      sources: [],
      citations: [],
      isLowConfidence: true,
    };
  }

  const filtered = filterByThreshold(results, filterThreshold);

  const citations: Citation[] = filtered.map(r => ({
    chunk_id: r.chunk.chunk_id,
    file: r.chunk.file,
    section: r.chunk.section,
    excerpt: r.chunk.text.slice(0, 300),
  }));

  const ragPrompt = buildRagSystemPromptWithCitations(filtered);
  const finalSystemPrompt = systemPromptPrefix + '\n\n' + ragPrompt;

  const apiResponse = await sendMessage(messages, model, finalSystemPrompt);

  const sources: SourceCited[] = filtered.map(r => ({
    title: r.chunk.title,
    section: r.chunk.section,
    score: r.score,
    file: r.chunk.file,
    chunk_id: r.chunk.chunk_id,
  }));

  return { answer: apiResponse.content, sources, citations, isLowConfidence: false };
}
```

### 2. `rag/index.ts` — экспорт новой функции

Добавить в существующий блок экспортов cited-функций (строки 9–14):
```typescript
export {
  ragQueryCited,
  ragQueryWithHistory,      // ← добавить сюда
  buildRagSystemPromptWithCitations,
  LOW_CONFIDENCE_THRESHOLD,
} from './querier.js';
```

### 3. `Chat.tsx` — изменение ragMode handler

Заменить:
```typescript
const ragAnswer: RagAnswerCited = await ragQueryCited(userInput, ragManager, currentModel);
```

На:
```typescript
// ВАЖНО: getMessagesForAPI() вызывается ПОСЛЕ addUserMessage(),
// чтобы текущее сообщение пользователя было включено в историю.
const systemPrefix = conversation.buildSystemPromptWithMemory();
const history = await conversation.getMessagesForAPI();
const ragAnswer: RagAnswerCited = await ragQueryWithHistory(
  userInput,
  history,
  systemPrefix,
  ragManager,
  currentModel,
);
```

---

## Сравнение: до и после

| Аспект | `ragQueryCited` (было) | `ragQueryWithHistory` (станет) |
|---|---|---|
| История диалога | ❌ Только текущий вопрос | ✅ Вся история |
| Task state в промпте | ❌ Нет | ✅ Через `buildSystemPromptWithMemory` |
| Профиль пользователя | ❌ Нет | ✅ Через `buildSystemPromptWithMemory` |
| Источники и цитаты | ✅ | ✅ (без изменений) |
| Low confidence режим | ✅ | ✅ (без изменений) |

---

## Тестирование

### Сценарий 1 — "Архитектурный вопрос с уточнениями" (~12 сообщений)

Тема: RAG vs Fine-tuning, постепенное уточнение требований

```
1. Привет, мне нужно улучшить качество ответов модели
2. У нас внутренняя база знаний на 500 документов
3. Данные обновляются каждую неделю
4. Нужно ли нам тогда файн-тюнить модель?
5. А что такое reranking и нужен ли он нам?
6-12. Дальнейшие уточнения...
```

**Критерий:** На сообщении #8+ агент помнит "500 документов" и "обновление раз в неделю".

### Сценарий 2 — "Технический выбор векторной БД" (~10 сообщений)

```
1. Какие векторные базы данных существуют?
2. У нас уже есть PostgreSQL в проде
3. Команда маленькая, 2 человека
4. Бюджет ограничен
5-10. Конкретизация требований...
```

**Критерий:** Агент консистентно рекомендует pgvector с учётом ограничений из #2-4.

### Критерии прохождения

- Каждый ответ содержит `📚 Источники` с файлами и score
- На сообщении #10 агент учитывает контекст из #2-3
- Task state корректно отображается в `/task`
- `/rag mode off` возвращает обычный чат без изменений

---

## План демо-видео (3-5 мин)

```
0:00 — Запуск агента, /rag mode on, /task show
0:30 — Сценарий 1: первые 3 сообщения, показываем источники
1:30 — Сообщение #7-8: агент помнит контекст из начала
2:30 — /task show — task state PLANNING с историей переходов
3:00 — Сценарий 2: быстрый прогон 5 сообщений
4:00 — Итог: ответ с источниками + task state
```

---

### Unit тест в `querier.test.ts`

Добавить минимальный тест, мокируя `ragManager.search` и `sendMessage`:

```typescript
describe('ragQueryWithHistory', () => {
  it('passes full message history to sendMessage', async () => {
    // mock ragManager.search → возвращает 1 chunk с score > 0.65
    // mock sendMessage → возвращает { content: 'answer', toolCalls: [] }
    // передаём history из 3 сообщений
    // проверяем: sendMessage вызван с messages.length === 3
    // проверяем: isLowConfidence === false, sources.length === 1
  });

  it('returns isLowConfidence when max score below threshold', async () => {
    // mock ragManager.search → возвращает chunks с score < 0.65
    // проверяем: isLowConfidence === true, answer содержит 'уточните вопрос'
  });
});
```

---

## Файлы для изменения

| Файл | Тип изменения |
|---|---|
| `src/rag/querier.ts` | Добавить импорт `Message`, добавить функцию `ragQueryWithHistory` |
| `src/rag/index.ts` | Добавить `ragQueryWithHistory` в существующий блок cited-экспортов |
| `src/components/Chat.tsx` | Заменить вызов в ragMode handler (~5 строк) |
| `src/rag/querier.test.ts` | Добавить 2 unit теста для `ragQueryWithHistory` |
