# Архитектура AI Агента

## Обзор

Агент построен по модульной архитектуре с четким разделением ответственности. Это **НЕ** просто функция для вызова API, а полноценная система с инкапсулированной логикой.

---

## Структура компонентов

```
┌─────────────────────────────────────────────────────┐
│                   USER INTERFACE                     │
│              (src/components/Chat.tsx)               │
│   • CLI интерфейс (Ink/React)                       │
│   • Обработка команд (/model, /clear, /skills)      │
│   • Отображение метрик и статистики                 │
└──────────────────┬──────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
┌───────────────┐    ┌──────────────────┐
│  CONVERSATION │    │  MODEL REGISTRY  │
│    MANAGER    │    │    & CONFIG      │
└───────┬───────┘    └────────┬─────────┘
        │                     │
        │ • Управление        │ • Загрузка моделей
        │   историей          │ • Расчет стоимости
        │ • Контекст          │ • Конфигурация
        │   диалога           │
        │                     │
        └──────────┬──────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │    API CLIENT       │
        │ (sendMessage)       │
        │                     │
        │ • HTTP запросы      │
        │ • Обработка ошибок  │
        │ • Метрики           │
        └──────────┬──────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │   OpenRouter API    │
        │    (External LLM)   │
        └─────────────────────┘
```

---

## Ключевые компоненты

### 1. Conversation Manager (Агент)

**Файл:** `src/chat/conversation.ts`

**Ответственность:** Управление состоянием диалога

```typescript
class Conversation {
  private messages: Message[] = []

  // Инкапсулированные методы
  addUserMessage(content: string): void
  addAssistantMessage(content: string): void
  getHistory(): Message[]
  clear(): void
}
```

**Инкапсулирует:**
- ✅ Состояние диалога (приватное поле `messages`)
- ✅ Логику добавления сообщений
- ✅ Управление контекстом

**Это отдельная сущность:** Класс с собственным состоянием и поведением.

---

### 2. API Client

**Файл:** `src/api/openrouter.ts`

**Ответственность:** Взаимодействие с LLM

```typescript
async function sendMessage(
  messages: Message[],
  modelId: string,
  systemPrompt?: string,
  temperature?: number
): Promise<ApiResponse>
```

**Инкапсулирует:**
- ✅ HTTP запросы к OpenRouter
- ✅ Аутентификацию (API ключ)
- ✅ Формирование запроса
- ✅ Парсинг ответа
- ✅ Обработку ошибок
- ✅ Сбор метрик (время ответа)

**Абстракция:** Скрывает детали работы с API от остальной системы.

---

### 3. Model Registry

**Файл:** `src/models/registry.ts`

**Ответственность:** Управление моделями

```typescript
class ModelRegistry {
  private models: Map<string, ModelInfo>

  async initialize(): Promise<void>
  getModel(id: string): ModelInfo | undefined
  calculateCost(modelId: string, usage: UsageInfo): number
}
```

**Инкапсулирует:**
- ✅ Информацию о доступных моделях
- ✅ Цены моделей (загружаются из API)
- ✅ Бизнес-логику расчета стоимости

---

### 4. Config Manager

**Файл:** `src/models/config.ts`

**Ответственность:** Управление конфигурацией

```typescript
class ConfigManager {
  private config: ModelConfig

  load(): ModelConfig
  save(config: ModelConfig): void
  setCurrentModel(modelId: string): void
  addFavoriteModel(modelId: string): boolean
  removeFavoriteModel(index: number): boolean
}
```

**Инкапсулирует:**
- ✅ Чтение/запись конфигурации
- ✅ Валидацию настроек
- ✅ Управление избранными моделями

---

## Почему это НЕ "просто один вызов API"?

### ❌ Плохая архитектура (один вызов API):
```typescript
// Все в одном месте, без инкапсуляции
const userInput = "Привет";
const response = await fetch('https://api.com', {
  method: 'POST',
  body: JSON.stringify({ message: userInput })
});
const data = await response.json();
console.log(data.response);
```

### ✅ Хорошая архитектура (наш агент):
```typescript
// 1. Отдельная сущность для управления диалогом
const conversation = new Conversation();
conversation.addUserMessage(userInput);

// 2. Инкапсулированный API клиент
const response = await sendMessage(
  conversation.getHistory(),
  modelId,
  systemPrompt,
  temperature
);

// 3. Сохранение состояния
conversation.addAssistantMessage(response.content);

// 4. Управление моделями
const cost = modelRegistry.calculateCost(modelId, response.usage);
```

---

## Принципы инкапсуляции

| Принцип | Реализация |
|---------|-----------|
| **Hiding Implementation** | Детали HTTP запросов скрыты в `sendMessage()` |
| **Data Encapsulation** | История диалога в `private messages[]` |
| **Single Responsibility** | Каждый класс отвечает за одну область |
| **Separation of Concerns** | UI, бизнес-логика и API разделены |

---

## Поток данных

### Полный цикл запроса:

```
1. USER INPUT
   └─> Chat.tsx (UI Layer)

2. COMMAND PROCESSING
   └─> handleCommand() - обработка команд
   └─> OR conversation.addUserMessage()

3. STATE MANAGEMENT
   └─> Conversation.messages[] обновляется

4. API CALL
   └─> sendMessage() формирует HTTP запрос
   └─> OpenRouter API обрабатывает
   └─> Возвращает ApiResponse с метриками

5. STATE UPDATE
   └─> conversation.addAssistantMessage()
   └─> sessionStats обновляется

6. DISPLAY
   └─> Chat.tsx рендерит результат
   └─> Показывает метрики и статистику
```

---

## Типизация данных

**Файл:** `src/types/index.ts`

Все взаимодействия типизированы:

```typescript
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ApiResponse {
  content: string;
  usage?: UsageInfo;
  responseTime: number;
}

interface SessionStats {
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}
```

Это обеспечивает:
- ✅ Type safety
- ✅ Автодополнение в IDE
- ✅ Раннее обнаружение ошибок

---

## Расширяемость

Благодаря модульной архитектуре легко добавить:

### Новые источники LLM
```typescript
// Просто создать новый API клиент
import { sendMessage as sendToAnthropic } from './api/anthropic.js';
```

### Новые типы агентов
```typescript
// Расширить Conversation для специализированных сценариев
class RAGConversation extends Conversation {
  private knowledge: VectorStore;
  // ...
}
```

### Новые команды
```typescript
// Добавить в Chat.tsx
if (trimmed.startsWith('/export')) {
  exportConversation(conversation.getHistory());
}
```

---

## Вывод

Агент реализован как **полноценная система** с:

1. ✅ **Отдельными сущностями** (классы с состоянием)
2. ✅ **Инкапсуляцией** (скрытие деталей реализации)
3. ✅ **Разделением ответственности** (каждый модуль отвечает за свою область)
4. ✅ **Управлением состоянием** (история диалога, конфигурация)
5. ✅ **Типизацией** (TypeScript интерфейсы)
6. ✅ **Расширяемостью** (легко добавить новый функционал)

Это **НЕ** просто обертка над fetch API, а **настоящий AI агент** с продуманной архитектурой.
