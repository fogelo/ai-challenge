# Дизайн механизма суммаризации контекста

**Дата:** 2026-02-26
**Статус:** Утверждено

## Обзор

Реализация механизма управления контекстом через суммаризацию диалога. Вместо отправки полной истории сообщений в API, старые сообщения заменяются на краткое резюме (summary), что позволяет экономить токены и управлять размером контекстного окна.

## Цели

- Хранить последние N сообщений "как есть" (без изменений)
- Остальные сообщения заменять summary
- Автоматическая суммаризация при превышении порогового значения
- Регулируемый порог заполнения контекста (от 0.01% до 100%)
- Команда `/compact` для ручной суммаризации
- Уведомления пользователю о выполненной суммаризации

## Выбранный подход: Гибридный с флагом

### Принцип работы

Используем флаг `needsSummarization` для отложенной суммаризации:

1. После каждого ответа проверяем процент заполнения контекста
2. Если превышен порог → устанавливаем флаг `needsSummarization = true`
3. При следующем запросе пользователя:
   - Проверяем флаг
   - Если `true` → выполняем суммаризацию → показываем уведомление
   - Отправляем запрос с актуальным контекстом
4. Команда `/compact` выполняет суммаризацию немедленно

### Преимущества

- Пользователь явно видит, когда происходит суммаризация
- Не тратим лишние запросы к API (если сессия завершена после превышения порога)
- Естественная интеграция команды `/compact`
- Легко экспериментировать с порогами

## Архитектура

### Изменения в Conversation

```typescript
class Conversation {
  private messages: Message[] = []
  private summary: string | null = null
  private needsSummarization: boolean = false

  // Новые методы:
  setSummary(summary: string): void
  getSummary(): string | null
  setNeedsSummarization(value: boolean): void
  needsSummarization(): boolean
  getMessagesForAPI(): Message[]  // summary + последние 10
  clear(): void  // очищает messages, summary, флаг
}
```

### Конфигурация

В `config.json` добавляется секция:

```json
{
  "summarization": {
    "threshold": 0.7,           // порог заполнения (70%)
    "keepRecentMessages": 10    // количество последних сообщений
  }
}
```

### Формат сохраненной сессии

```typescript
interface SavedSession {
  timestamp: string
  messages: Message[]
  summary?: string              // новое поле
  needsSummarization?: boolean  // новое поле
  modelId: string
  stats: SessionStats
}
```

**Обратная совместимость:** не требуется, старые сессии будут удалены.

## Логика суммаризации

### Функция getMessagesForAPI()

```typescript
getMessagesForAPI(): Message[] {
  if (this.summary) {
    // Если есть summary, возвращаем его + последние N сообщений
    const recent = this.messages.slice(-keepRecentMessages)
    return [
      { role: 'system', content: this.summary },
      ...recent
    ]
  }
  // Если summary нет, возвращаем все сообщения
  return this.messages
}
```

### Процесс суммаризации

```typescript
async function summarizeConversation() {
  const messages = conversation.getHistory()
  const toSummarize = messages.slice(0, -keepRecentMessages)

  // Промпт для суммаризации
  const summaryPrompt = `Создай краткое резюме следующего диалога,
сохраняя ключевые темы, решения и важный контекст.
Формат: 2-3 абзаца на русском языке.`

  // Запрос к API (используем текущую модель)
  const response = await sendMessage(
    [{ role: 'system', content: summaryPrompt }, ...toSummarize],
    currentModel
  )

  conversation.setSummary(response.content)
  conversation.setNeedsSummarization(false)
}
```

### Проверка порога

```typescript
function checkContextThreshold(): boolean {
  const totalTokens = calculateTokens(conversation.getHistory())
  const modelContextWindow = modelRegistry.getModel(currentModel).contextWindow
  const percentage = totalTokens / modelContextWindow

  return percentage > config.summarization.threshold
}
```

## Поток работы

### При вводе сообщения пользователем

```
1. Проверяем conversation.needsSummarization()
2. Если true:
   - Показываем "⚡ Выполняется суммаризация контекста..."
   - Вызываем summarizeConversation()
   - Показываем "✓ Контекст сжат: N сообщений → summary + 10 последних"
3. Добавляем сообщение пользователя
4. Отправляем запрос с conversation.getMessagesForAPI()
```

### После получения ответа

```
1. Добавляем ответ в историю
2. Вызываем checkContextThreshold()
3. Если превышен порог:
   - conversation.setNeedsSummarization(true)
```

### Команда /compact

```
1. Проверяем, нужна ли суммаризация (> 10 сообщений)
2. Если нужна:
   - Показываем "⚡ Суммаризация диалога..."
   - Вызываем summarizeConversation()
   - Показываем результат с метриками
3. Если не нужна:
   - Показываем "ℹ️ Суммаризация не требуется (контекст: X%)"
```

## UI и уведомления

### Сообщения пользователю

**Автоматическая суммаризация:**
```
⚡ Выполняется суммаризация контекста...
✓ Контекст сжат: 45 сообщений → summary + 10 последних
```

**Ручная суммаризация (/compact):**
```
⚡ Суммаризация диалога...
✓ Готово! Сжато 35 сообщений, сохранены последние 10
💾 Токены: 8500 → ~2000 (экономия 76%)
```

**Суммаризация не требуется:**
```
ℹ️ Суммаризация не требуется (контекст: 15%)
```

### Визуальные индикаторы

- Добавить индикатор `[S]` в статусной строке при наличии summary
- Пример: `Context: 35% [S] | Tokens: 2500/8000`
- Состояние `isSummarizing` для показа процесса

### Обновление help

Добавить в список команд:
```
/compact - выполнить суммаризацию контекста вручную
```

## Изменяемые файлы

1. **src/chat/conversation.ts**
   - Добавить поля `summary`, `needsSummarization`
   - Реализовать методы управления summary
   - Реализовать `getMessagesForAPI()`

2. **src/chat/session.ts**
   - Расширить `SavedSession` интерфейс
   - Сохранять/восстанавливать `summary` и `needsSummarization`

3. **src/components/Chat.tsx**
   - Добавить логику проверки флага перед запросом
   - Добавить функцию `summarizeConversation()`
   - Добавить функцию `checkContextThreshold()`
   - Реализовать команду `/compact`
   - Добавить уведомления о суммаризации
   - Добавить индикатор `[S]`

4. **src/models/config.ts**
   - Добавить секцию `summarization` в конфиг
   - Методы для чтения настроек суммаризации

5. **src/types/index.ts**
   - Обновить интерфейс `SavedSession`
   - Добавить тип для конфига суммаризации

## Технические детали

### Расчет токенов

Используем существующую функцию `calculateTokens()` для подсчета токенов в сообщениях. Приблизительная оценка: ~4 символа = 1 токен (для латиницы), ~2-3 символа = 1 токен (для кириллицы).

### Генерация summary

- Используется текущая выбранная модель
- Summary генерируется из всех сообщений кроме последних 10
- При повторной суммаризации старый summary + новые сообщения → новый summary
- Промпт на русском языке для получения резюме на русском

### Сохранение в сессии

- Summary сохраняется как строка в JSON
- Флаг `needsSummarization` сохраняется как boolean
- При восстановлении сессии оба поля восстанавливаются

## Эксперименты и настройка

### Порог суммаризации

Пользователь может экспериментировать с порогом в `config.json`:

```json
"threshold": 0.01  // суммаризация при 1% заполнения
"threshold": 0.5   // при 50%
"threshold": 0.9   // при 90%
```

### Количество сохраняемых сообщений

По умолчанию: 10 последних сообщений
Можно изменить в конфиге:

```json
"keepRecentMessages": 5   // меньше контекста, больше экономия
"keepRecentMessages": 20  // больше контекста, меньше экономия
```

## Ограничения

- Summary генерируется на основе текущей модели (дополнительный запрос к API)
- Качество summary зависит от выбранной модели
- При малом количестве сообщений (< 10) суммаризация не выполняется

## Будущие улучшения

- Опциональное использование быстрой дешевой модели для summary
- Метрики эффективности суммаризации (экономия токенов)
- История суммаризаций (несколько блоков)
- Экспорт summary отдельно от сессии
