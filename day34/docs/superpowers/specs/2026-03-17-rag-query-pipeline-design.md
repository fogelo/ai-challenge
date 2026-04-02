# RAG Query Pipeline — Design Spec
**Дата:** 2026-03-17
**День курса:** Day 22, урок 2 из 5
**Задача:** Реализовать полный RAG-пайплайн с двумя режимами и 10 контрольными вопросами

---

## 1. Контекст

Агент уже имеет инфраструктуру RAG (`RagManager`, chunker, embedder, searcher). База знаний — 153 чанка из 4 книг по архитектуре ПО. Команда `/rag <запрос>` возвращает только найденные чанки — до LLM данные не доходят.

**Цель:** реализовать пайплайн `вопрос → поиск чанков → промпт → LLM → ответ с источниками`, добавить режим-переключатель и механизм тестирования.

---

## 2. Новые файлы

### `src/rag/querier.ts`

Содержит:
- `ragQuery(question, ragManager, model)` — полный пайплайн:
  1. `ragManager.search(question, 'structural', 5)` → топ-5 чанков (стратегия `structural` по умолчанию)
  2. Построение системного промпта: контекст из `chunk.text` каждого чанка + инструкция отвечать только на основе источников
  3. Построение массива сообщений: `[{ role: 'user', content: question }]` — без истории диалога
  4. `sendMessage(messages, model, systemPrompt)` → ответ LLM
  5. Возвращает `{ answer: string, sources: Source[] }`, где `sources` извлекаются из `SearchResult[]` (не из ответа LLM)
- `loadControlQuestions(resolvedPath: string)` — принимает абсолютный путь к файлу, читает JSON, возвращает `ControlQuestion[]`

```ts
interface RagTestResult {
  controlQuestion: ControlQuestion;
  answerWithoutRag: string;
  answerWithRag: string;
  sources: Source[];
}

interface Source {
  title: string;    // chunk.title
  section: string;  // chunk.section
  score: number;    // result.score (косинусное сходство)
}

interface RagAnswer {
  answer: string;
  sources: Source[];
}

interface ControlQuestion {
  question: string;
  expectedAnswer: string;
  expectedSources: string[];
}
```

### `rag-data/control-questions.json`
10 вопросов по содержимому базы знаний. Создаётся как часть этой задачи, редактируется вручную без изменения кода. Читается при каждом запуске `/rag test` через `loadControlQuestions`.

Формат:
```json
[
  {
    "question": "Что такое fitness functions?",
    "expectedAnswer": "Механизм для измерения архитектурных характеристик...",
    "expectedSources": ["Ричардс. Фундаментальный подход к программной архитектуре"]
  }
]
```

---

## 3. Изменения в существующих файлах

### `src/rag/index.ts`
Добавить экспорт: `ragQuery`, `loadControlQuestions`, `RagAnswer`, `Source`, `ControlQuestion`, `RagTestResult`.

### `src/components/Chat.tsx`

**Новые стейты:**
- `ragMode: boolean` — включён ли RAG-режим (по умолчанию `false`)
- `ragTestMode: boolean` — идёт ли прогон теста (по умолчанию `false`)
- `ragTestStep: number` — текущий шаг теста (индекс вопроса)
- `ragTestResults: RagTestResult[]` — накопленные результаты

**Обработка Enter в `useInput`:**
Когда `ragTestMode = true` и пользователь нажимает Enter (в том числе с пустым полем ввода) — продвигать шаг теста: `setRagTestStep(s => s + 1)`. Если шаг превышает количество вопросов — завершить тест, сбросить `ragTestMode = false`.

**Новые `/rag` команды:**
- `/rag mode on` — установить `ragMode = true`, показать уведомление
- `/rag mode off` — установить `ragMode = false`, показать уведомление
- `/rag test` — установить `ragTestMode = true`, `ragTestStep = 0`, запустить прогон

**Обновить `/help`:** добавить `/rag mode on/off` и `/rag test` в список команд.

**Перехват обычных сообщений при `ragMode = true`:**
Вместо прямого `sendMessage` вызывать `ragQuery`. Ответ и вопрос сохранять в `conversation` как обычные сообщения — так сохраняется история диалога. Системный промпт RAG передаётся только в вызов `ragQuery` и не меняет глобальный системный промпт агента.

### Формат ответа с источниками (когда RAG-режим включён):
```
[ответ LLM]

─────────────────
📚 Источники:
• Ford. Software Architecture — Глава 3: Modularity (0.87)
• Ричардс. Фундаментальный подход — Архитектурные стили (0.82)
```

---

## 4. Команда `/rag test`

Алгоритм:
1. Загрузить вопросы из `rag-data/control-questions.json` (путь: `path.resolve('rag-data', 'control-questions.json')`)
2. Показать заголовок: `"Тест RAG: N вопросов. Нажмите Enter для следующего вопроса."`
3. Для каждого вопроса (шаг теста = индекс в массиве):
   a. Показать вопрос + ожидаемый ответ
   b. Вызвать `sendMessage([{ role: 'user', content: question }], currentModel)` (без RAG, без истории)
   c. Показать ответ без RAG
   d. Вызвать `ragQuery(question, ragManager, currentModel)` → показать ответ + источники
   e. Ждать нажатия Enter (`ragTestMode = true` + обработчик в `useInput`)
4. После последнего вопроса: сбросить `ragTestMode = false`, показать `"Тест завершён."`

---

## 5. Системный промпт для RAG-режима

```
Ты — ассистент по архитектуре ПО. Отвечай ТОЛЬКО на основе предоставленного контекста.
Если ответа нет в контексте — честно скажи об этом.
Не придумывай информацию, которой нет в источниках.

Контекст:
[chunk.text чанка 1]
---
[chunk.text чанка 2]
---
...
```

---

## 6. Контрольные вопросы

10 вопросов охватывают 4 книги базы знаний:
1. Ford — Software Architecture: The Hard Parts (2-3 вопроса)
2. Head First — Паттерны проектирования (2-3 вопроса)
3. Head First — Архитектура ПО (2 вопроса)
4. Ричардс — Фундаментальный подход к программной архитектуре (2-3 вопроса)

Файл `rag-data/control-questions.json` создаётся как часть этой задачи.

---

## 7. Что НЕ входит в этот спринт

- Reranking (день 5 курса)
- Hybrid Search (BM25 + vector)
- Автоматическая оценка качества (RAGAS)
- Метаданные и фильтрация
