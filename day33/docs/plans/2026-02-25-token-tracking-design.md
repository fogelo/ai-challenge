# Дизайн: Подсчёт токенов и мониторинг контекста

**Дата:** 2026-02-25
**Статус:** Утверждено

## Цель

Добавить в AI агент функционал детального подсчёта токенов для:
- Текущего запроса (prompt + completion)
- Всей истории диалога (накопительно)
- Ответа модели

Показать:
- Как растёт стоимость/токены по мере диалога
- Предупреждения о приближении к лимиту контекста модели
- Детальную статистику по каждому запросу через команду `/stats`

## Требования

1. Подсчёт токенов для каждого запроса (prompt/completion/total)
2. Команда `/stats` для вывода истории запросов с метриками
3. Предупреждения о заполнении контекстного окна (в процентах)
4. Сохранение метрик вместе с историей диалога

## Архитектура

### 1. Типы данных

Расширяем `Message` интерфейс в `src/types/index.ts`:

```typescript
export interface MessageMetadata {
  usage?: UsageInfo;          // токены (prompt/completion/total)
  responseTime?: number;       // время ответа в секундах
  cost?: number;              // стоимость в USD
  model?: string;             // ID модели
  timestamp?: string;         // ISO timestamp
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: MessageMetadata;  // только для assistant сообщений
}
```

**Обоснование:**
- Метрики привязаны к сообщениям (cohesion)
- `metadata` опционален — не ломает существующий код
- User сообщения не имеют metadata (метрики есть только у ответов)
- Автоматически сохраняется в `.chat-history/`

### 2. Поток данных

**Модификация в `src/chat/conversation.ts`:**

```typescript
class Conversation {
  addAssistantMessage(content: string, metadata?: MessageMetadata): void {
    this.messages.push({
      role: 'assistant',
      content,
      metadata
    });
  }
}
```

**Изменения в `src/components/Chat.tsx` (строки 320-345):**

Было:
```typescript
const apiResponse = await sendMessage(...);
conversation.addAssistantMessage(apiResponse.content);
```

Стало:
```typescript
const apiResponse = await sendMessage(...);

const metadata: MessageMetadata = {
  usage: apiResponse.usage,
  responseTime: apiResponse.responseTime,
  cost: apiResponse.usage
    ? modelRegistry.calculateCost(currentModel, apiResponse.usage)
    : undefined,
  model: currentModel,
  timestamp: new Date().toISOString(),
};

conversation.addAssistantMessage(apiResponse.content, metadata);
```

**Поток:**
1. User вводит сообщение → `addUserMessage(content)`
2. API запрос → `ApiResponse` с usage и responseTime
3. Формируем `MessageMetadata` с расчетом стоимости
4. Сохраняем → `addAssistantMessage(content, metadata)`
5. Auto-save → метрики сохраняются в session JSON

### 3. Команда `/stats`

Добавляется в `handleCommand()` в `Chat.tsx`:

**Логика:**
1. Получаем историю: `conversation.getHistory()`
2. Фильтруем пары user-assistant запросов
3. Для каждого показываем:
   - Номер запроса
   - Превью текста (первые 50 символов)
   - Токены (prompt/completion/total)
   - Стоимость в USD
   - Время ответа
   - Модель
4. В конце: итоговая статистика

**Формат вывода:**
```
История запросов:

#1. "Привет, как дела?"
   Токены: 150 (prompt: 20, completion: 130)
   Стоимость: $0.000045
   Время: 1.23s
   Модель: anthropic/claude-3.5-sonnet

#2. "Расскажи про TypeScript"
   Токены: 500 (prompt: 50, completion: 450)
   Стоимость: $0.000150
   Время: 2.45s
   Модель: anthropic/claude-3.5-sonnet

Всего запросов: 2
Всего токенов: 650 (prompt: 70, completion: 580)
Общая стоимость: $0.000195
```

### 4. Предупреждения о лимитах контекста

**Новая функция в `Chat.tsx`:**

```typescript
function getContextWarning(
  totalPromptTokens: number,
  modelId: string,
  modelRegistry: ModelRegistry
): { level: 'none' | 'warning' | 'critical'; message: string }
```

**Логика:**
- Получаем `context_length` модели из `modelRegistry`
- Вычисляем процент использования: `(totalPromptTokens / contextLength) * 100`
- Вычисляем оставшийся процент: `100 - usagePercent`

**Пороги:**
- До 70%: серый текст, информация
- 70-90%: желтый, предупреждение ⚡
- >90%: красный, критично ⚠️

**Формат:**
```
Контекст: 5000/8000 (62.5%). Осталось 37.5%
⚡ Предупреждение: Контекст 6000/8000 (75.0%). Осталось 25.0%
⚠️  КРИТИЧНО: Контекст почти заполнен 7500/8000 (93.8%). Осталось 6.2%
```

**Интеграция в UI:**
- Показывается под метриками последнего ответа
- Цвет текста меняется в зависимости от уровня
- Обновляется после каждого запроса

## Обработка ошибок

### 1. Старые сессии без metadata
- При загрузке через `/resume` старые сообщения работают
- `/stats` показывает "Метрики недоступны" для старых запросов
- Не ломает функционал

### 2. API не вернул usage
- Проверка `if (apiResponse.usage)` перед использованием
- Показываем "N/A" в метриках
- Не сохраняем некорректные данные

### 3. Переполнение контекста
- Модель вернет ошибку 400/413 от API
- Существующий error handling отлавливает
- Пользователь видит красное предупреждение заранее (>90%)
- Решение: `/clear` для сброса контекста

### 4. Модель без context_length
- Проверка в `getContextWarning`
- Возвращаем `level: 'none'`
- Предупреждения не показываются

### 5. Пустая история при `/stats`
- Проверка `if (requests.length === 0)`
- Показываем "Нет запросов для отображения"

## Обратная совместимость

- ✅ `metadata` опционален — старые сессии работают
- ✅ `SessionData` структура не меняется
- ✅ Существующие команды не затронуты
- ✅ API клиент не модифицируется

## Тестовые сценарии

### Короткий диалог (2-3 запроса)
- Проверка подсчёта токенов
- Проверка накопительной статистики
- `/stats` показывает корректные данные

### Длинный диалог (10+ запросов)
- Мониторинг роста токенов
- Предупреждения при приближении к лимиту
- Производительность при больших объемах

### Переполнение контекста
- Использовать модель с маленьким context_length
- Достичь >90% заполнения
- Проверить красное предупреждение
- Проверить поведение при ошибке от API

## Файлы для изменения

1. `src/types/index.ts` — добавить `MessageMetadata`
2. `src/chat/conversation.ts` — модифицировать `addAssistantMessage()`
3. `src/components/Chat.tsx`:
   - Добавить команду `/stats` в `handleCommand()`
   - Добавить функцию `getContextWarning()`
   - Обновить сохранение assistant сообщений с metadata
   - Добавить UI блок для отображения предупреждений

## Преимущества решения

1. **Минимальные изменения** — только 4 файла
2. **Персистентность** — метрики сохраняются на диск
3. **Обратная совместимость** — не ломает существующий код
4. **Расширяемость** — легко добавить новые метрики в metadata
5. **Информативность** — детальная статистика по каждому запросу
6. **Безопасность** — предупреждения о переполнении контекста

## Следующие шаги

1. Реализовать изменения в типах
2. Модифицировать Conversation класс
3. Добавить команду `/stats`
4. Реализовать функцию `getContextWarning()`
5. Интегрировать предупреждения в UI
6. Протестировать все сценарии
7. Обновить README.md с документацией `/stats`
