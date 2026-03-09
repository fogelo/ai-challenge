# Design: Model Switching Feature

**Date:** 2026-02-23
**Status:** Approved

## Overview

Добавление возможности переключения моделей через команду `/model` вместо хардкоженной модели в `.env` файле. Пользователь сможет выбирать из предустановленных моделей разной мощности (слабые, средние, сильные) и добавлять свои для сравнения статистики.

## Goals

- Переключение между моделями через CLI команды
- Список из 6 предустановленных моделей разной мощности
- Возможность добавления/удаления моделей
- Актуальные цены для расчета стоимости из OpenRouter API
- Сохранение выбора между сессиями

## Architecture

### Новые модули

1. **Model Registry** (`src/models/registry.ts`)
   - Загружает список моделей из OpenRouter `/api/v1/models` API
   - Хранит метаданные моделей (ID, название, цены) в памяти
   - Предоставляет методы поиска и расчета стоимости

2. **Model Config Manager** (`src/models/config.ts`)
   - Управляет файлом `config.json` в корне проекта
   - Хранит текущую модель и список избранных
   - CRUD операции с конфигурацией

3. **Model Commands Handler**
   - Расширение `handleCommand()` в `Chat.tsx`
   - Обработка команд `/model`, `/model <номер>`, `/model add`, `/model remove`

### Изменения в существующих модулях

- `src/api/openrouter.ts`: использовать modelId из config вместо `process.env.OPENROUTER_MODEL`
- `src/components/Chat.tsx`: использовать `modelRegistry.calculateCost()` вместо хардкоженой функции
- `src/index.tsx`: инициализация registry и config manager перед запуском Chat

## Components

### ModelRegistry Interface

```typescript
interface ModelInfo {
  id: string;              // "anthropic/claude-3.5-sonnet"
  name: string;            // "Claude 3.5 Sonnet"
  pricing: {
    prompt: string;        // "0.000003" (цена за токен)
    completion: string;    // "0.000015"
  };
  context_length?: number;
}

class ModelRegistry {
  async initialize(): Promise<void>
  getModel(id: string): ModelInfo | undefined
  getAllModels(): ModelInfo[]
  calculateCost(modelId: string, usage: UsageInfo): number
}
```

### ConfigManager Interface

```typescript
interface ModelConfig {
  currentModel: string;           // ID активной модели
  favoriteModels: string[];       // список ID избранных
}

class ConfigManager {
  load(): ModelConfig
  save(config: ModelConfig): void
  setCurrentModel(modelId: string): void
  addFavoriteModel(modelId: string): void
  removeFavoriteModel(index: number): void
}
```

### Предустановленные модели

Дефолтный `config.json`:
```json
{
  "currentModel": "anthropic/claude-3.5-sonnet",
  "favoriteModels": [
    "google/gemini-flash-1.5",
    "meta-llama/llama-3.1-8b-instruct",
    "anthropic/claude-3-haiku",
    "openai/gpt-4o-mini",
    "anthropic/claude-3.5-sonnet",
    "openai/gpt-4o"
  ]
}
```

Категории:
- **Слабые**: Gemini Flash 1.5, Llama 3.1 8B
- **Средние**: Claude 3 Haiku, GPT-4o Mini
- **Сильные**: Claude 3.5 Sonnet, GPT-4o

### Commands

| Команда | Действие |
|---------|----------|
| `/model` | Показать список избранных с номерами и отметкой текущей |
| `/model <номер>` | Переключиться на модель по номеру (1-based index) |
| `/model add <model-id>` | Добавить модель в избранное |
| `/model remove <номер>` | Удалить модель из избранного |

## Data Flow

### Initialization

1. `index.tsx` создает `ModelRegistry` и вызывает `initialize()`
2. Registry запрашивает `GET https://openrouter.ai/api/v1/models`
3. Парсит и сохраняет массив моделей в памяти
4. `ConfigManager.load()` читает `config.json`
5. Если файла нет, создается дефолтный с 6 моделями
6. Chat получает registry и config через props/context

### Model Switching

1. Пользователь: `/model 3`
2. `handleCommand()` парсит команду
3. Получает `favoriteModels` из config
4. Берет `favoriteModels[2]` (0-based)
5. Проверяет в registry существование модели
6. `configManager.setCurrentModel(modelId)` → сохраняет в `config.json`
7. State обновляется, следующий запрос использует новую модель

### Cost Calculation

1. API возвращает `usage: { prompt_tokens, completion_tokens }`
2. Вызов `modelRegistry.calculateCost(currentModelId, usage)`
3. Registry находит модель, парсит `pricing.prompt` и `pricing.completion`
4. Вычисляет: `prompt_tokens * prompt_price + completion_tokens * completion_price`
5. Возвращает стоимость в USD

## Error Handling

### ModelRegistry Initialization

- **API недоступен**: показать warning, fallback на хардкоженые цены ($3/$15 для Claude)
- **Неверный формат**: логировать, использовать fallback

### Config File

- **Не существует**: создать дефолтный
- **Невалидный JSON**: показать ошибку, создать новый, сохранить старый как `.backup`
- **Модель отсутствует в registry**: фильтровать при загрузке, показать уведомление

### Commands

- `/model <номер>` вне диапазона: "Номер должен быть от 1 до N"
- `/model add <id>` не найдена: "Модель не найдена в OpenRouter"
- `/model add <id>` дубликат: "Модель уже в списке"
- `/model remove <номер>` последняя модель: "Должна остаться хотя бы одна модель"

### Cost Calculation

- **Цены отсутствуют**: отображать "N/A"
- **Бесплатная модель** (pricing = "0"): отображать "$0.00"

## Implementation Notes

- OpenRouter API endpoint: `GET https://openrouter.ai/api/v1/models`
- Ответ: `{ data: ModelInfo[] }`
- Цены в формате строк, представляют cost per token в USD
- Config file location: `./config.json` (корень проекта)
- Fallback model: `anthropic/claude-3.5-sonnet` с ценами $3/$15 per 1M tokens

## Success Criteria

- Пользователь может переключаться между моделями через `/model <номер>`
- Актуальные цены загружаются при старте
- Выбор сохраняется между сессиями
- Можно добавлять/удалять модели
- Корректный расчет стоимости для каждой модели
- Graceful degradation при недоступности API
