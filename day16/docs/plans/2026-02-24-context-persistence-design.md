# Дизайн: Сохранение контекста диалога

**Дата:** 2026-02-24
**Задача:** День 7 - Добавить сохранение и восстановление контекста между запусками агента

---

## Требования

1. Хранить историю диалога (messages) в JSON файлах
2. При перезапуске агента загружать историю через команду `/resume`
3. Продолжать диалог как будто агент не выключался
4. Автоматическое сохранение после каждого сообщения
5. Корректная работа при завершении через Ctrl+C
6. Нет деления на current/archive - просто список сессий

---

## 1. Архитектура

### Структура хранения

```
.chat-history/
├── session-2026-02-24-10-30-abc123.json
├── session-2026-02-24-15-45-def456.json
└── session-2026-02-24-18-20-ghi789.json
```

### Формат файла сессии

```json
{
  "id": "abc123",
  "createdAt": "2026-02-24T20:45:30.123Z",
  "updatedAt": "2026-02-24T20:47:15.456Z",
  "messages": [
    { "role": "user", "content": "Привет" },
    { "role": "assistant", "content": "Здравствуйте!" }
  ],
  "stats": {
    "totalTokens": 150,
    "totalPromptTokens": 50,
    "totalCompletionTokens": 100,
    "totalCost": 0.000375,
    "requestCount": 1
  }
}
```

### Жизненный цикл сессии

1. **Запуск агента** → создается новая сессия с уникальным ID
2. **Каждое сообщение** → автоматически сохраняется в файл сессии
3. **Ctrl+C** → graceful shutdown с финальным сохранением
4. **Перезапуск** → новая пустая сессия
5. **/resume** → показывает список сессий, позволяет выбрать и загрузить

---

## 2. Компоненты

### SessionManager (новый класс)

**Файл:** `src/chat/session.ts`

```typescript
interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  stats: SessionStats;
}

interface SessionMetadata {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

class SessionManager {
  private currentSessionId: string | null = null;
  private historyDir: string = '.chat-history';

  // Создать новую сессию
  createSession(): string;

  // Сохранить данные сессии
  saveSession(sessionId: string, data: SessionData): void;

  // Загрузить сессию по ID
  loadSession(sessionId: string): SessionData | null;

  // Получить список всех сессий (сортировка по дате)
  listSessions(): SessionMetadata[];

  // Удалить сессию
  deleteSession(sessionId: string): void;

  // Получить текущий ID сессии
  getCurrentSessionId(): string | null;
}
```

**Реализация:**
- Использует `fs` для работы с файлами
- Генерирует ID через `crypto.randomBytes(4).toString('hex')`
- Имя файла: `session-${timestamp}-${id}.json`
- Создает `.chat-history/` если не существует

### Обновление Conversation

**Файл:** `src/chat/conversation.ts`

```typescript
class Conversation {
  private messages: Message[] = [];
  private sessionManager: SessionManager;
  private currentSessionId: string;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.currentSessionId = sessionManager.createSession();
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content });
    this.autoSave();
  }

  addAssistantMessage(content: string): void {
    this.messages.push({ role: 'assistant', content });
    this.autoSave();
  }

  // Загрузить сессию
  resumeSession(sessionId: string, stats: SessionStats): boolean {
    const data = this.sessionManager.loadSession(sessionId);
    if (!data) return false;

    this.messages = data.messages;
    this.currentSessionId = sessionId;
    return true;
  }

  // Автосохранение после каждого сообщения
  private autoSave(): void {
    // Вызывается из addUserMessage/addAssistantMessage
    // Сохраняет текущее состояние через sessionManager
  }

  // Метод для сохранения перед выходом
  saveBeforeExit(stats: SessionStats): void {
    this.autoSave();
  }

  getHistory(): Message[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
    // Создаем новую сессию после очистки
    this.currentSessionId = this.sessionManager.createSession();
  }
}
```

### Обновление Chat.tsx

**Команда /resume:**

```typescript
if (trimmed === '/resume') {
  const sessions = sessionManager.listSessions();

  if (sessions.length === 0) {
    setNotification('Нет сохраненных сессий');
    return true;
  }

  let output = 'Сохраненные сессии:\n';
  sessions.forEach((session, index) => {
    const date = new Date(session.createdAt).toLocaleString('ru-RU');
    output += `${index + 1}. ${date} (${session.messageCount} сообщений)\n`;
  });
  output += '\nИспользуйте /resume <номер> для загрузки';

  setNotification(output);
  return true;
}

if (trimmed.startsWith('/resume ')) {
  const arg = trimmed.slice('/resume '.length).trim();
  const num = parseInt(arg, 10);

  const sessions = sessionManager.listSessions();

  if (isNaN(num) || num < 1 || num > sessions.length) {
    setNotification(`Номер должен быть от 1 до ${sessions.length}`);
    return true;
  }

  const session = sessions[num - 1];
  const loaded = conversation.resumeSession(session.id, sessionStats);

  if (!loaded) {
    setNotification('Не удалось загрузить сессию');
    return true;
  }

  // Обновляем UI с загруженной историей
  setMessages(conversation.getHistory());

  // Загружаем статистику из сессии
  const data = sessionManager.loadSession(session.id);
  if (data?.stats) {
    setSessionStats(data.stats);
  }

  setNotification(`Сессия загружена: ${new Date(session.createdAt).toLocaleString('ru-RU')}`);
  return true;
}
```

**Обработчик Ctrl+C:**

```typescript
useEffect(() => {
  const handleExit = () => {
    try {
      conversation.saveBeforeExit(sessionStats);
      console.log('\nСессия сохранена. До встречи!');
    } catch (error) {
      console.error('\nОшибка при сохранении:', error.message);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', handleExit);

  return () => {
    process.off('SIGINT', handleExit);
  };
}, [conversation, sessionStats]);
```

### Обновление типов

**Файл:** `src/types/index.ts`

```typescript
export interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  stats: SessionStats;
}

export interface SessionMetadata {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}
```

---

## 3. Поток данных

### Сценарий 1: Новая сессия

```
1. Запуск агента
   └─> SessionManager.createSession()
       └─> Генерирует ID (например, "abc123")
       └─> Создает файл .chat-history/session-2026-02-24-20-45-abc123.json

2. Пользователь вводит сообщение
   └─> conversation.addUserMessage(text)
       └─> messages.push({ role: 'user', content: text })
       └─> autoSave() → записывает в JSON файл

3. Приходит ответ от LLM
   └─> conversation.addAssistantMessage(response)
       └─> messages.push({ role: 'assistant', content: response })
       └─> autoSave() → обновляет JSON файл с новым сообщением

4. Пользователь нажимает Ctrl+C
   └─> SIGINT обработчик
       └─> conversation.saveBeforeExit(sessionStats)
       └─> Финальное сохранение
       └─> process.exit(0)
```

### Сценарий 2: Восстановление сессии

```
1. Запуск агента (новая пустая сессия)

2. Пользователь вводит /resume
   └─> sessionManager.listSessions()
       └─> Читает все файлы из .chat-history/
       └─> Возвращает список: [{ id, createdAt, messageCount }, ...]
       └─> Показывает в UI:
           1. 24.02.2026 20:45 (5 сообщений)
           2. 24.02.2026 18:30 (12 сообщений)
           3. 24.02.2026 10:15 (3 сообщения)

3. Пользователь вводит /resume 2
   └─> conversation.resumeSession(sessions[1].id, sessionStats)
       └─> sessionManager.loadSession(id)
       └─> Загружает messages[] и stats
       └─> Обновляет UI с историей
       └─> currentSessionId = загруженный ID
       └─> Продолжает работу с этой сессией
```

---

## 4. Обработка ошибок

### Файловая система

```typescript
// Создание директории
if (!fs.existsSync(this.historyDir)) {
  fs.mkdirSync(this.historyDir, { recursive: true });
}

// Чтение поврежденного JSON
try {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data;
} catch (error) {
  console.error(`Не удалось загрузить сессию ${sessionId}:`, error.message);
  return null;
}

// Ошибка записи
try {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
} catch (error) {
  console.error('Ошибка сохранения сессии:', error.message);
  // Продолжаем работу, показываем предупреждение
}
```

### Команда /resume

```typescript
// Нет сессий
if (sessions.length === 0) {
  setNotification('Нет сохраненных сессий');
  return;
}

// Неверный номер
if (num < 1 || num > sessions.length) {
  setNotification(`Номер должен быть от 1 до ${sessions.length}`);
  return;
}

// Сессия не загрузилась
if (!loaded) {
  setNotification('Не удалось загрузить сессию');
  return;
}
```

### Graceful shutdown

```typescript
process.on('SIGINT', () => {
  try {
    conversation.saveBeforeExit(sessionStats);
    console.log('\nСессия сохранена. До встречи!');
  } catch (error) {
    console.error('\nОшибка при сохранении:', error.message);
  } finally {
    process.exit(0);
  }
});
```

**Стратегия:** Все ошибки логируются, но не прерывают работу агента. Пользователь видит уведомления в UI.

---

## 5. Тестирование

### Тест 1: Автосохранение
1. Запустить агент
2. Отправить сообщение "Привет"
3. Проверить, что создался файл в `.chat-history/`
4. Открыть файл - должно быть 2 сообщения (user + assistant)
5. Отправить еще одно сообщение
6. Проверить, что файл обновился (4 сообщения)

### Тест 2: Ctrl+C
1. Запустить агент
2. Отправить несколько сообщений
3. Нажать Ctrl+C
4. Проверить, что файл сессии сохранен
5. Открыть файл - все сообщения должны быть там

### Тест 3: Resume без сессий
1. Удалить `.chat-history/`
2. Запустить агент
3. Ввести `/resume`
4. Должно показать: "Нет сохраненных сессий"

### Тест 4: Resume с выбором сессии
1. Создать 2-3 сессии (запуск, диалог, Ctrl+C)
2. Запустить агент
3. Ввести `/resume`
4. Должен показать список с датами и количеством сообщений
5. Ввести `/resume 2`
6. Проверить, что загрузилась история и статистика
7. Отправить новое сообщение - должно добавиться в загруженную сессию

### Тест 5: Поврежденный JSON
1. Создать сессию
2. Вручную испортить JSON файл (удалить скобку)
3. Попробовать `/resume <номер>`
4. Должно показать ошибку, но не упасть

### Тест 6: Статистика сохраняется
1. Создать сессию с несколькими сообщениями
2. Проверить накопленную статистику (токены, стоимость)
3. Перезапустить агент
4. Загрузить сессию через `/resume`
5. Проверить, что статистика восстановилась
6. Отправить новое сообщение - статистика должна обновиться

### Критерии успеха
- ✅ Сессия сохраняется после каждого сообщения
- ✅ Корректное завершение при Ctrl+C
- ✅ `/resume` показывает список сессий
- ✅ Загруженная сессия продолжает работать
- ✅ Статистика сохраняется и восстанавливается

---

## Выводы

Дизайн обеспечивает:
1. ✅ Автоматическое сохранение контекста после каждого сообщения
2. ✅ Graceful shutdown при Ctrl+C
3. ✅ Восстановление сессий через `/resume`
4. ✅ Простую структуру хранения (JSON файлы)
5. ✅ Сохранение статистики (токены, стоимость)
6. ✅ Надежную обработку ошибок

Решение соответствует требованиям дня 7 курса и легко расширяется в будущем.
