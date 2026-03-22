# RAG Query Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать полный RAG-пайплайн (вопрос → чанки → LLM → ответ с источниками), режим-переключатель `/rag mode on/off` и команду `/rag test` для сравнения ответов с RAG и без.

**Architecture:** Новый модуль `src/rag/querier.ts` содержит функции `ragQuery` и `loadControlQuestions` — всю LLM-интеграцию RAG. `RagManager` остаётся чистым инструментом поиска. `Chat.tsx` получает стейт `ragMode` + `ragTestMode`/`ragTestStep` по образцу существующего `interviewMode`.

**Tech Stack:** TypeScript, Ink (React terminal UI), OpenRouter API (`sendMessage` из `src/api/openrouter.ts`), Vitest, существующий `RagManager` из `src/rag/`.

---

## Chunk 1: `src/rag/querier.ts` — ядро RAG-пайплайна

**Files:**
- Create: `src/rag/querier.ts`
- Create: `tests/rag/querier.test.ts`

---

- [ ] **Шаг 1.1: Написать тест на `buildRagSystemPrompt`**

Создать файл `tests/rag/querier.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRagSystemPrompt } from '../../src/rag/querier.js';
import type { SearchResult } from '../../src/rag/types.js';

const makeResult = (text: string, title: string, section: string, score: number): SearchResult => ({
  chunk: {
    chunk_id: 'id',
    source: '/src.md',
    file: 'src.md',
    title,
    section,
    strategy: 'structural',
    text,
    embedding: [],
  },
  score,
});

describe('buildRagSystemPrompt', () => {
  it('включает текст каждого чанка в промпт', () => {
    const results = [makeResult('Текст первого чанка', 'Book A', 'Глава 1', 0.9)];
    const prompt = buildRagSystemPrompt(results);
    expect(prompt).toContain('Текст первого чанка');
  });

  it('разделяет чанки через ---', () => {
    const results = [
      makeResult('Чанк 1', 'Book A', '', 0.9),
      makeResult('Чанк 2', 'Book B', '', 0.8),
    ];
    const prompt = buildRagSystemPrompt(results);
    expect(prompt).toContain('---');
  });

  it('содержит инструкцию отвечать только по контексту', () => {
    const prompt = buildRagSystemPrompt([]);
    expect(prompt.toLowerCase()).toContain('контекст');
  });
});
```

- [ ] **Шаг 1.2: Запустить тест — убедиться что он падает**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day22
npx vitest run tests/rag/querier.test.ts
```

Ожидаемый результат: ошибка импорта (`Cannot find module '../../src/rag/querier.js'`)

- [ ] **Шаг 1.3: Создать `src/rag/querier.ts` с функцией `buildRagSystemPrompt`**

```ts
import fs from 'fs/promises';
import type { SearchResult } from './types.js';
import { sendMessage } from '../api/openrouter.js';
import type { RagManager } from './RagManager.js';

export interface Source {
  title: string;
  section: string;
  score: number;
}

export interface RagAnswer {
  answer: string;
  sources: Source[];
}

export interface ControlQuestion {
  question: string;
  expectedAnswer: string;
  expectedSources: string[];
}

export interface RagTestResult {
  controlQuestion: ControlQuestion;
  answerWithoutRag: string;
  answerWithRag: string;
  sources: Source[];
}

export function buildRagSystemPrompt(results: SearchResult[]): string {
  const contextBlocks = results.map((r) => r.chunk.text).join('\n---\n');
  return (
    'Ты — ассистент по архитектуре ПО. Отвечай ТОЛЬКО на основе предоставленного контекста.\n' +
    'Если ответа нет в контексте — честно скажи об этом.\n' +
    'Не придумывай информацию, которой нет в источниках.\n\n' +
    'Контекст:\n' +
    contextBlocks
  );
}

export async function ragQuery(
  question: string,
  ragManager: RagManager,
  model: string,
): Promise<RagAnswer> {
  const results = await ragManager.search(question, 'structural', 5);
  const systemPrompt = buildRagSystemPrompt(results);
  const messages = [{ role: 'user' as const, content: question }];
  const apiResponse = await sendMessage(messages, model, systemPrompt);
  const sources: Source[] = results.map((r) => ({
    title: r.chunk.title,
    section: r.chunk.section,
    score: r.score,
  }));
  return { answer: apiResponse.content, sources };
}

export async function loadControlQuestions(resolvedPath: string): Promise<ControlQuestion[]> {
  const raw = await fs.readFile(resolvedPath, 'utf-8');
  return JSON.parse(raw) as ControlQuestion[];
}
```

- [ ] **Шаг 1.4: Запустить тест — убедиться что проходит**

```bash
npx vitest run tests/rag/querier.test.ts
```

Ожидаемый результат: все 3 теста проходят (`buildRagSystemPrompt`)

- [ ] **Шаг 1.5: Написать тест на `loadControlQuestions`**

Добавить в `tests/rag/querier.test.ts`:

```ts
import { loadControlQuestions } from '../../src/rag/querier.js';
import type { ControlQuestion } from '../../src/rag/querier.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

describe('loadControlQuestions', () => {
  it('читает и парсит JSON файл с вопросами', async () => {
    const tmpFile = path.join(os.tmpdir(), 'test-questions.json');
    const questions: ControlQuestion[] = [
      {
        question: 'Что такое RAG?',
        expectedAnswer: 'Retrieval Augmented Generation',
        expectedSources: ['Book A'],
      },
    ];
    await fs.writeFile(tmpFile, JSON.stringify(questions), 'utf-8');

    const loaded = await loadControlQuestions(tmpFile);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].question).toBe('Что такое RAG?');

    await fs.unlink(tmpFile);
  });

  it('выбрасывает ошибку если файл не найден', async () => {
    await expect(loadControlQuestions('/nonexistent/path.json')).rejects.toThrow();
  });
});
```

- [ ] **Шаг 1.6: Запустить все тесты querier — убедиться что все проходят**

```bash
npx vitest run tests/rag/querier.test.ts
```

Ожидаемый результат: 5 тестов — все проходят

- [ ] **Шаг 1.7: Запустить весь suite тестов — убедиться что ничего не сломалось**

```bash
npx vitest run
```

Ожидаемый результат: все тесты проходят

- [ ] **Шаг 1.8: Коммит**

```bash
git add src/rag/querier.ts tests/rag/querier.test.ts
git commit -m "feat(rag): add ragQuery and loadControlQuestions in querier.ts"
```

---

## Chunk 2: `rag-data/control-questions.json` — 10 контрольных вопросов

**Files:**
- Create: `rag-data/control-questions.json`

---

- [ ] **Шаг 2.1: Изучить содержимое базы знаний для составления вопросов**

```bash
node -e "
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('rag-data/index-structural.json', 'utf8'));
const byTitle = {};
d.chunks.forEach(c => {
  if (!byTitle[c.title]) byTitle[c.title] = [];
  byTitle[c.title].push(c.section);
});
Object.entries(byTitle).forEach(([t, sections]) => {
  console.log('\\n=== ' + t.slice(0, 60));
  [...new Set(sections)].slice(0, 8).forEach(s => s && console.log('  -', s));
});
"
```

- [ ] **Шаг 2.2: Создать файл с 10 вопросами**

Создать `rag-data/control-questions.json` на основе реального содержимого индекса. Вопросы должны охватывать все 4 книги:

```json
[
  {
    "question": "Что такое архитектурные характеристики (architectural characteristics) и какие категории они включают?",
    "expectedAnswer": "Архитектурные характеристики — это нефункциональные требования к системе, которые влияют на её дизайн. Включают операционные характеристики (производительность, масштабируемость, доступность), структурные (модульность, расширяемость) и сквозные (безопасность, совместимость).",
    "expectedSources": ["Ричардс. Фундаментальный подход к программной архитектуре"]
  },
  {
    "question": "В чём разница между монолитной и распределённой архитектурой с точки зрения trade-offs?",
    "expectedAnswer": "Монолитная архитектура проще в развёртывании и отладке, но хуже масштабируется. Распределённая обеспечивает масштабируемость и отказоустойчивость, но добавляет сложность коммуникации, согласованность данных и операционные расходы.",
    "expectedSources": ["00. Ford. Software Architecture. The Hard Parts. Modern Trade-Off Analyses for Distributed Architectures.md"]
  },
  {
    "question": "Что такое паттерн Наблюдатель (Observer) и когда его применяют?",
    "expectedAnswer": "Observer — поведенческий паттерн, в котором объект (Subject) уведомляет список зависимых объектов (Observers) об изменениях своего состояния. Применяют когда изменение одного объекта требует обновления других, и количество зависимых объектов заранее неизвестно.",
    "expectedSources": ["00. Head First. Паттерны проектирования.md"]
  },
  {
    "question": "Что такое паттерн Декоратор (Decorator) и чем он отличается от наследования?",
    "expectedAnswer": "Decorator динамически добавляет объекту новые обязанности, оборачивая его в объект-обёртку. В отличие от наследования, не требует изменения исходного класса и позволяет комбинировать поведения во время выполнения.",
    "expectedSources": ["00. Head First. Паттерны проектирования.md"]
  },
  {
    "question": "Что такое связность (coupling) и связанность (cohesion) в архитектуре ПО?",
    "expectedAnswer": "Cohesion (связанность) — степень, в которой элементы модуля относятся к единой ответственности. Coupling (связность) — степень зависимости между модулями. Цель — высокая cohesion и низкий coupling, что упрощает изменения и тестирование.",
    "expectedSources": ["Ричардс. Фундаментальный подход к программной архитектуре"]
  },
  {
    "question": "Что такое сервис-ориентированная архитектура (SOA) и каковы её основные принципы?",
    "expectedAnswer": "SOA — архитектурный стиль, в котором функциональность предоставляется в виде слабосвязанных сервисов с определёнными интерфейсами. Принципы: повторное использование сервисов, стандартизированные контракты, слабая связность, автономность.",
    "expectedSources": ["Ричардс. Фундаментальный подход к программной архитектуре"]
  },
  {
    "question": "Как работает паттерн Стратегия (Strategy) и в чём его преимущество перед условными операторами?",
    "expectedAnswer": "Strategy инкапсулирует алгоритм в отдельный класс и делает его взаимозаменяемым. Вместо разветвлённой логики if/switch клиент выбирает нужную стратегию. Упрощает добавление новых алгоритмов без изменения существующего кода.",
    "expectedSources": ["00. Head First. Паттерны проектирования.md"]
  },
  {
    "question": "Что такое data decomposition drivers при декомпозиции данных в распределённых системах?",
    "expectedAnswer": "Data decomposition drivers — факторы, влияющие на решение о разделении данных: изменяемость данных, уровень доступа, транзакционные требования, согласованность. Помогают определить, стоит ли хранить данные совместно или разделить между сервисами.",
    "expectedSources": ["00. Ford. Software Architecture. The Hard Parts. Modern Trade-Off Analyses for Distributed Architectures.md"]
  },
  {
    "question": "Что такое архитектурные стили событийно-ориентированной архитектуры (Event-Driven)?",
    "expectedAnswer": "Event-Driven архитектура — стиль, в котором компоненты взаимодействуют через события асинхронно. Включает два топологических варианта: Mediator (координатор обрабатывает события) и Broker (компоненты напрямую публикуют и подписываются на события).",
    "expectedSources": ["Ричардс. Фундаментальный подход к программной архитектуре"]
  },
  {
    "question": "Что такое архитектурные фитнес-функции и как они используются для governance архитектуры?",
    "expectedAnswer": "Fitness functions — любой механизм, обеспечивающий объективную оценку архитектурных характеристик. Могут быть автоматическими (тесты, метрики) или ручными. Позволяют встроить архитектурный governance в CI/CD и защитить архитектурные решения от деградации.",
    "expectedSources": ["Ричардс. Фундаментальный подход к программной архитектуре"]
  }
]
```

- [ ] **Шаг 2.3: Проверить что файл валидный JSON**

```bash
node -e "const d = require('./rag-data/control-questions.json'); console.log('Вопросов:', d.length); d.forEach((q,i) => console.log(i+1 + '.', q.question.slice(0, 60)))"
```

Ожидаемый результат: 10 вопросов, без ошибок парсинга

- [ ] **Шаг 2.4: Коммит**

```bash
git add rag-data/control-questions.json
git commit -m "feat(rag): add 10 control questions for RAG evaluation"
```

---

## Chunk 3: Экспорты `src/rag/index.ts`

**Files:**
- Modify: `src/rag/index.ts`

---

- [ ] **Шаг 3.1: Добавить экспорты в `src/rag/index.ts`**

Текущее содержимое файла:
```ts
export { RagManager } from './RagManager.js';
export type { Chunk, IndexFile, SearchResult, RagConfig, ChunkStrategy } from './types.js';
```

Заменить на:
```ts
export { RagManager } from './RagManager.js';
export type { Chunk, IndexFile, SearchResult, RagConfig, ChunkStrategy } from './types.js';
export { ragQuery, loadControlQuestions, buildRagSystemPrompt } from './querier.js';
export type { Source, RagAnswer, ControlQuestion, RagTestResult } from './querier.js';
```

- [ ] **Шаг 3.2: Убедиться что сборка проходит**

```bash
npx tsc --noEmit
```

Ожидаемый результат: нет ошибок типов

- [ ] **Шаг 3.3: Коммит**

```bash
git add src/rag/index.ts
git commit -m "feat(rag): export ragQuery and related types from rag/index.ts"
```

---

## Chunk 4: `Chat.tsx` — режим `/rag mode on/off` и перехват сообщений

**Files:**
- Modify: `src/components/Chat.tsx`

---

- [ ] **Шаг 4.1: Добавить импорт `ragQuery` в `Chat.tsx`**

Найти строку (≈ строка 20):
```ts
import { RagManager } from '../rag/index.js';
```

Заменить на:
```ts
import { RagManager, ragQuery } from '../rag/index.js';
import type { RagAnswer } from '../rag/index.js';
```

- [ ] **Шаг 4.2: Добавить стейт `ragMode`**

Найти блок инициализации стейтов (после `const [interviewAnswers` ≈ строка 224). Добавить сразу после:
```ts
const [ragMode, setRagMode] = useState(false);
```

- [ ] **Шаг 4.3: Добавить команды `/rag mode on/off` в обработчик `/rag`**

Найти в обработчике `/rag` (≈ строка 1252) блок:
```ts
if (args === 'index' || args === '') {
```

Перед этим блоком вставить:
```ts
      if (args === 'mode on') {
        setRagMode(true);
        setNotification('🔍 RAG-режим включён. Все ответы будут дополнены источниками из базы знаний.');
        return true;
      }

      if (args === 'mode off') {
        setRagMode(false);
        setNotification('💬 RAG-режим выключен. Агент отвечает из общих знаний.');
        return true;
      }
```

- [ ] **Шаг 4.4: Обновить help-текст для `/rag`**

Найти (≈ строка 1268):
```ts
        setNotification(
          'RAG команды:\n' +
          '  /rag index             — индексировать документы\n' +
          '  /rag <запрос>          — поиск (structural)\n' +
          '  /rag <запрос> --fixed  — поиск (fixed)\n' +
          '  /rag compare <запрос>  — сравнить стратегии'
        );
```

Заменить на:
```ts
        setNotification(
          'RAG команды:\n' +
          '  /rag mode on           — включить RAG-режим для всего чата\n' +
          '  /rag mode off          — выключить RAG-режим\n' +
          '  /rag test              — запустить 10 контрольных вопросов\n' +
          '  /rag index             — индексировать документы\n' +
          '  /rag <запрос>          — поиск (structural)\n' +
          '  /rag <запрос> --fixed  — поиск (fixed)\n' +
          '  /rag compare <запрос>  — сравнить стратегии'
        );
```

- [ ] **Шаг 4.5: Обновить общий `/help` текст**

Найти блок помощи с RAG-командами (≈ строка 1392–1396):
```ts
🔍 RAG:
  /rag index             — индексировать документы
  /rag <запрос>          — поиск по базе знаний
  /rag <запрос> --fixed  — поиск (fixed стратегия)
  /rag compare <запрос>  — сравнить две стратегии
```

Заменить на:
```ts
🔍 RAG:
  /rag mode on/off       — включить/выключить RAG-режим
  /rag test              — запустить 10 контрольных вопросов
  /rag index             — индексировать документы
  /rag <запрос>          — поиск по базе знаний
  /rag <запрос> --fixed  — поиск (fixed стратегия)
  /rag compare <запрос>  — сравнить две стратегии
```

- [ ] **Шаг 4.6: Перехватить обычные сообщения при `ragMode = true`**

В функции обработки отправки сообщения (≈ строка 310, внутри блока `if (key.return) { if (input.trim()) {`) найти блок, который начинается как:
```ts
    setIsLoading(true);

    try {
      // Check if summarization is needed before processing
      if (conversation.needsSummarization()) {
```

Добавить **перед** этим блоком (перед `setIsLoading(true)`):

```ts
        // RAG-режим: перехватываем сообщение и используем RAG-пайплайн
        if (ragMode) {
          setIsLoading(true);
          try {
            await conversation.addUserMessage(userInput);
            const ragAnswer = await ragQuery(userInput, ragManager, currentModel);
            const sourcesBlock =
              ragAnswer.sources.length > 0
                ? '\n\n─────────────────\n📚 Источники:\n' +
                  ragAnswer.sources
                    .map((s) => `• ${s.title}${s.section ? ` — ${s.section}` : ''} (${s.score.toFixed(2)})`)
                    .join('\n')
                : '';
            const fullAnswer = ragAnswer.answer + sourcesBlock;
            const metadata: MessageMetadata = {
              model: currentModel,
              timestamp: new Date().toISOString(),
            };
            await conversation.addAssistantMessage(fullAnswer, metadata);
            setMessages(conversation.getHistory());
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            setNotification(`❌ RAG ошибка: ${msg}`);
          } finally {
            setIsLoading(false);
          }
          return;
        }
```

- [ ] **Шаг 4.7: Убедиться что сборка проходит**

```bash
npx tsc --noEmit
```

Ожидаемый результат: нет ошибок типов

- [ ] **Шаг 4.8: Коммит**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): add ragMode toggle (/rag mode on/off) with message interception"
```

---

## Chunk 5: `Chat.tsx` — команда `/rag test`

**Files:**
- Modify: `src/components/Chat.tsx`

---

- [ ] **Шаг 5.1: Добавить стейты для `/rag test`**

Сразу после стейта `ragMode` (добавленного в шаге 4.2) добавить:
```ts
const [ragTestMode, setRagTestMode] = useState(false);
const [ragTestStep, setRagTestStep] = useState(0);
const [ragTestResults, setRagTestResults] = useState<RagTestResult[]>([]);
const [ragTestQuestions, setRagTestQuestions] = useState<ControlQuestion[]>([]);
```

Добавить импорт типов в импорт rag (обновить строку из шага 4.1):
```ts
import { RagManager, ragQuery, loadControlQuestions } from '../rag/index.js';
import type { RagAnswer, RagTestResult, ControlQuestion } from '../rag/index.js';
```

- [ ] **Шаг 5.2: Добавить команду `/rag test` в обработчик `/rag`**

В блок `/rag` команд (после блока `/rag mode off`) добавить:
```ts
      if (args === 'test') {
        try {
          const questions = await loadControlQuestions(
            path.resolve('rag-data', 'control-questions.json')
          );
          setRagTestQuestions(questions);
          setRagTestResults([]);
          setRagTestStep(0);
          setRagTestMode(true);
          setNotification(
            `🧪 Тест RAG: ${questions.length} вопросов.\n` +
            `Нажмите Enter для следующего вопроса.\n\n` +
            `Вопрос 1/${questions.length}:\n${questions[0].question}`
          );
          // Сразу запустить первый вопрос
          runRagTestStep(questions, 0);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          setNotification(`❌ Не удалось загрузить вопросы: ${msg}`);
        }
        return true;
      }
```

- [ ] **Шаг 5.3: Добавить функцию `runRagTestStep`**

Определить функцию внутри компонента `Chat` (перед `useInput`, например после функции `performSummarization`):

```ts
  const runRagTestStep = async (questions: ControlQuestion[], step: number) => {
    if (step >= questions.length) {
      setRagTestMode(false);
      setNotification('✅ Тест завершён.');
      return;
    }
    const q = questions[step];
    setIsLoading(true);
    try {
      const [withoutRagResponse, withRagAnswer] = await Promise.all([
        sendMessage([{ role: 'user', content: q.question }], currentModel),
        ragQuery(q.question, ragManager, currentModel),
      ]);

      const result: RagTestResult = {
        controlQuestion: q,
        answerWithoutRag: withoutRagResponse.content,
        answerWithRag: withRagAnswer.answer,
        sources: withRagAnswer.sources,
      };

      setRagTestResults((prev) => [...prev, result]);

      const sourcesBlock =
        withRagAnswer.sources.length > 0
          ? '\n\n📚 Источники (RAG):\n' +
            withRagAnswer.sources
              .map((s) => `• ${s.title}${s.section ? ` — ${s.section}` : ''} (${s.score.toFixed(2)})`)
              .join('\n')
          : '';

      const nextHint =
        step < questions.length - 1
          ? `\n\n─────────────────\nНажмите Enter для вопроса ${step + 2}/${questions.length}`
          : '\n\n─────────────────\nНажмите Enter для завершения теста';

      setNotification(
        `🧪 Вопрос ${step + 1}/${questions.length}: ${q.question}\n\n` +
        `❓ Ожидаемый ответ:\n${q.expectedAnswer}\n\n` +
        `💬 БЕЗ RAG:\n${withoutRagResponse.content}\n\n` +
        `🔍 С RAG:\n${withRagAnswer.answer}` +
        sourcesBlock +
        nextHint
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setNotification(`❌ Ошибка на вопросе ${step + 1}: ${msg}`);
      setRagTestMode(false);
    } finally {
      setIsLoading(false);
    }
  };
```

- [ ] **Шаг 5.4: Добавить обработку Enter в `ragTestMode` в `useInput`**

Найти в `useInput` (≈ строка 1614) блок обработки `interviewMode`:
```ts
        // Handle interview mode
        if (interviewMode) {
```

Добавить **перед** этим блоком:
```ts
        // Handle rag test mode — advance on Enter (even empty input)
        if (ragTestMode) {
          const nextStep = ragTestStep + 1;
          setRagTestStep(nextStep);
          if (nextStep >= ragTestQuestions.length) {
            setRagTestMode(false);
            setNotification('✅ Тест завершён.');
          } else {
            runRagTestStep(ragTestQuestions, nextStep);
          }
          return;
        }
```

Также нужно убедиться что пустой Enter обрабатывается в `ragTestMode`. Найти строку:
```ts
      if (input.trim()) {
```

Изменить условие на:
```ts
      if (input.trim() || ragTestMode) {
```

- [ ] **Шаг 5.5: Убедиться что сборка проходит**

```bash
npx tsc --noEmit
```

Ожидаемый результат: нет ошибок типов

- [ ] **Шаг 5.6: Запустить все тесты**

```bash
npx vitest run
```

Ожидаемый результат: все тесты проходят

- [ ] **Шаг 5.7: Коммит**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): add /rag test command with step-by-step RAG vs no-RAG comparison"
```

---

## Финальная проверка

- [ ] **Шаг 6.1: Собрать проект**

```bash
npm run build 2>/dev/null || npx tsc
```

Ожидаемый результат: компиляция без ошибок (или убедиться что `dist/` обновлён)

- [ ] **Шаг 6.2: Проверить что `rag-data/control-questions.json` существует и валиден**

```bash
node -e "const d = require('./rag-data/control-questions.json'); console.log('OK:', d.length, 'вопросов')"
```

- [ ] **Шаг 6.3: Финальный прогон тестов**

```bash
npx vitest run
```

Ожидаемый результат: все тесты зелёные
