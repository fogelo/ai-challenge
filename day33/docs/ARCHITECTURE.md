# Архитектура AI Агента — День 31

## Обзор

Модульный CLI-агент на TypeScript + Ink (React для терминала). Взаимодействует с LLM через OpenRouter API.

---

## Структура модулей

```
src/
├── index.tsx                    # Точка входа
├── components/
│   └── Chat.tsx                 # Основной UI (Ink), обработка всех команд
├── api/
│   └── openrouter.ts            # HTTP клиент OpenRouter API
├── chat/
│   ├── conversation.ts          # История диалога, суммаризация
│   └── session.ts               # Сохранение/загрузка сессий (.chat-history/)
├── models/
│   ├── registry.ts              # Список моделей, цены, расчёт стоимости
│   └── config.ts                # ConfigManager: config.json
├── memory/
│   └── MemoryManager.ts         # Три слоя памяти: short/working/long-term
├── profile/
│   └── ProfileManager.ts        # Профили пользователей, интервью
├── skills/
│   └── index.ts                 # Предустановленные system-prompt скиллы
├── strategies/
│   ├── SlidingWindowStrategy.ts # Последние N сообщений
│   ├── StickyFactsStrategy.ts   # Важные факты + sliding window
│   └── BranchingStrategy.ts     # Ветки диалога с чекпоинтами
├── taskstate/
│   ├── TaskStateMachine.ts      # FSM: PLANNING → EXECUTION → VALIDATION → DONE
│   └── types.ts                 # TaskState enum
├── invariants/
│   ├── InvariantStorage.ts      # Загрузка .invariants/default.json
│   ├── InvariantValidator.ts    # LLM-валидация ответов
│   ├── InvariantInjector.ts     # Форматирование в system prompt
│   └── InvariantManager.ts      # Координатор
├── mcp/
│   ├── client.ts                # MCPClientManager: подключение к серверам
│   ├── server-ai.ts             # Инструменты: summarize, classify, sentiment
│   ├── server-files.ts          # Инструменты: saveToFile, readFile, listFiles
│   ├── server-utils.ts          # Инструменты: get_time, git_status, weather, reminders
│   ├── server-web.ts            # Инструменты: fetchUrl, searchWeb
│   └── server-git.ts            # Инструменты: get_branch, list_files, get_diff
├── rag/
│   ├── RagManager.ts            # Координатор: index, search, compare
│   ├── indexer.ts               # Сборка индекса из .md файлов + эмбеддинги
│   ├── chunker.ts               # Разбивка на чанки: fixed / structural
│   ├── embedder.ts              # Ollama embeddings (nomic-embed-text)
│   ├── searcher.ts              # Косинусное сходство
│   ├── reranker.ts              # Фильтрация по threshold
│   ├── querier.ts               # ragQuery, ragQueryEnhanced, ragQueryCited
│   └── types.ts                 # Chunk, SearchResult, RagConfig
├── reminders/
│   └── index.ts                 # Напоминания с таймером
├── utils/
│   └── tokens.ts                # Подсчёт токенов
└── types/
    └── index.ts                 # Общие TypeScript типы
```

---

## Команды агента

| Команда | Описание |
|---------|----------|
| `/model` | Переключение модели |
| `/clear` | Очистка контекста |
| `/compact` | Ручная суммаризация |
| `/stats` | Метрики запросов |
| `/resume` | Загрузка сессии |
| `/task` | Task State Machine |
| `/next` | Следующий этап задачи |
| `/profile` | Управление профилями |
| `/skills` | Активация скиллов |
| `/strategy` | Переключение стратегии |
| `/invariants` | Инварианты проекта |
| `/mcp` | MCP инструменты |
| `/rag` | RAG поиск по документации |
| `/ask` | Developer assistant (RAG + git) |
| `/remind` | Напоминания |
| `/memory` | Просмотр памяти |
| `/help` | Список всех команд |

---

## Поток данных

```
Пользователь → Chat.tsx
  ├── Команда (/xxx) → handleCommand()
  └── Обычное сообщение → conversation.addUserMessage()
                           → sendMessage() → OpenRouter API
                           → conversation.addAssistantMessage()
```

---

## RAG Pipeline

```
/rag index → for_rag/project-docs/ → chunker → embedder (Ollama) → rag-data/index-*.json
/ask <вопрос> → ragManager.search() → top-3 chunks
              + MCP get_branch/list_files
              → system prompt с контекстом
              → sendMessage() → ответ
```

---

## MCP Architecture

Каждый MCP сервер — отдельный Node.js процесс, общение через stdio.
`MCPClientManager` запускает все серверы при `/mcp connect` или `/ask`.

Серверы:
- `server-utils` — утилиты, git статус, погода, напоминания
- `server-files` — работа с файлами в `output/`
- `server-ai` — AI операции: суммаризация, классификация
- `server-web` — веб-запросы
- `server-git` — git контекст: ветка, структура, diff (используется `/ask`)

---

## Task State Machine

```
PLANNING 🟡 → EXECUTION 🔵 → VALIDATION 🟠 → DONE 🟢
                   ↑                ↓
                   └──── (issues) ──┘
```

Состояния управляются командами `/task new`, `/task load`, `/next`.

---

## Система памяти

Три слоя:
- **Short-term** — текущая сессия (`.memory/short-term/`)
- **Working** — рабочий контекст задачи
- **Long-term** — накопленные знания (`.memory/long-term/`)

Профили хранятся в `.memory/profiles/`.
