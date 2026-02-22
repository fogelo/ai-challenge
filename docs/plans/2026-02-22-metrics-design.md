# Дизайн: Метрики API запросов

**Дата:** 2026-02-22
**Автор:** CLI Agent Day 5
**Статус:** Утвержден

## Обзор

Добавление отображения метрик после каждого ответа модели: время ответа, количество токенов и стоимость запросов. Метрики включают данные текущего запроса и накопленную статистику сессии.

## Требования

1. После каждого ответа модели выводить:
   - Время, потребовавшееся на ответ
   - Количество токенов (общее, prompt, completion)
   - Стоимость запроса
2. Показывать накопленную статистику сессии
3. Использовать данные из OpenRouter API
4. Компактный однострочный формат
5. Органично отображать отсутствие метрик (N/A)

## Выбранный подход

**Подход 1: Расширенный API Response**

Модифицируем `sendMessage()` для возврата полного объекта с метриками. Добавляем state для накопления статистики в компоненте `Chat`.

### Преимущества
- Простая и понятная реализация
- Минимальные изменения в архитектуре
- Вся логика метрик в одном месте
- Следует принципу YAGNI

## Детальный дизайн

### 1. Типы данных (`types/index.ts`)

```typescript
export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenRouterResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
  }>;
  usage?: UsageInfo;
}

export interface ApiResponse {
  content: string;
  usage?: UsageInfo;
  responseTime: number;  // в секундах
}

export interface SessionStats {
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  requestCount: number;
}
```

### 2. API клиент (`api/openrouter.ts`)

**Изменения:**

1. Возвращаем `ApiResponse` вместо `string`
2. Замеряем время ответа через `performance.now()`
3. Возвращаем полные данные включая `usage`

```typescript
export async function sendMessage(
  messages: Message[],
  systemPrompt?: string,
  temperature?: number
): Promise<ApiResponse> {
  // ... существующая логика ...

  const startTime = performance.now();
  const response = await fetch(...);
  const responseTime = (performance.now() - startTime) / 1000;

  const data: OpenRouterResponse = await response.json();

  return {
    content: data.choices[0].message.content,
    usage: data.usage,
    responseTime
  };
}
```

### 3. Chat компонент (`components/Chat.tsx`)

**Новый state:**

```typescript
const [sessionStats, setSessionStats] = useState<SessionStats>({
  totalTokens: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalCost: 0,
  requestCount: 0,
});

const [lastResponseMetrics, setLastResponseMetrics] = useState<{
  responseTime: number;
  usage?: UsageInfo;
} | null>(null);
```

**Логика обновления:**

1. При отправке нового сообщения - очищаем `lastResponseMetrics`
2. При получении ответа - сохраняем метрики
3. Если есть `usage` - обновляем `sessionStats`

**Helper функция расчета стоимости:**

```typescript
function calculateCost(usage: UsageInfo): number {
  // Примерные цены для Claude 3.5 Sonnet через OpenRouter
  const inputCost = (usage.prompt_tokens / 1_000_000) * 3;
  const outputCost = (usage.completion_tokens / 1_000_000) * 15;
  return inputCost + outputCost;
}
```

### 4. UI отображение

**Формат вывода:**

Когда все данные доступны:
```
⏱ 2.3s | 📊 1247 tokens (prompt: 450, completion: 797) | 💰 $0.004500
📈 Session total: 5430 tokens | $0.018200
```

Когда usage данные недоступны:
```
⏱ 2.3s | 📊 N/A tokens | 💰 N/A
📈 Session total: N/A tokens | N/A
```

**Позиционирование:**
- После каждого ответа ассистента
- Перед полем ввода
- С `dimColor` для ненавязчивости

## Обработка ошибок

1. Отсутствие `usage` в ответе - показываем N/A
2. Время ответа доступно всегда (замеряется на клиенте)
3. Статистика сессии не сбрасывается при ошибках API

## Ограничения

1. Цены захардкожены для Claude 3.5 Sonnet
2. Для точной стоимости других моделей нужен mapping или данные от OpenRouter
3. Статистика сбрасывается при перезапуске приложения

## Будущие улучшения

1. Получение точных цен от OpenRouter API (если поддерживается)
2. Сохранение статистики между сессиями
3. Команда `/stats` для детального отчета
4. Экспорт статистики в файл
