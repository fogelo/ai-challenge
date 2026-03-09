# Дизайн AI Агента - MVP

**Дата:** 2026-02-28
**Версия:** 1.0 (MVP)
**Статус:** Утвержден

## Обзор

Создание базового AI агента на основе Electron React шаблона с возможностью общения с LLM через OpenRouter API. Это фундамент для будущего развития в универсального AI ассистента, сочетающего возможности ChatGPT, Cursor, Claude Code и других инструментов.

## Цели MVP

- Простой чат-интерфейс с сохранением истории
- Интеграция с OpenRouter API для работы с различными LLM
- Надежная архитектура для итеративного развития
- Файловое хранение конфигурации и истории чатов

## Стратегия развития

**Сейчас (MVP):**
- Один чат на весь экран
- Полные ответы (без streaming)
- Конфигурация через JSON файл
- Базовый UI

**Следующие итерации:**
- Streaming ответов
- UI для настроек
- Sidebar с множественными чатами
- Работа с кодом и файлами
- Универсальный ассистент

---

## 1. Архитектура

### Структура проекта

```
app/
  components/
    chat/
      ChatContainer.tsx      # Главный компонент чата
      MessageList.tsx        # Список сообщений с автоскроллом
      MessageItem.tsx        # Отдельное сообщение (user/assistant)
      ChatInput.tsx          # Поле ввода с кнопкой отправки
  stores/
    useChatStore.ts          # Zustand store для состояния чата
  types/
    chat.ts                  # TypeScript типы для сообщений

lib/
  conveyor/
    schemas/
      ai-schema.ts           # Zod схемы для AI операций
    api/
      ai-api.ts              # API методы для AI
    handlers/
      ai-handler.ts          # Обработчики в main process
  main/
    services/
      openrouter.ts          # Сервис для работы с OpenRouter API
      storage.ts             # Сервис для работы с файловой системой
```

### Хранение данных

**Расположение:** Electron `userData` директория

**config.json:**
```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-...",
    "model": "anthropic/claude-3.5-sonnet",
    "temperature": 0.7,
    "maxTokens": 4096
  }
}
```

**chat-history.json:**
```json
{
  "messages": [
    {
      "id": "uuid",
      "role": "user" | "assistant",
      "content": "текст сообщения",
      "timestamp": 1234567890
    }
  ]
}
```

### Conveyor IPC API

Новые методы в AI API:

- `sendMessage(message: string, history: Message[])` → `Message`
  - Отправить сообщение в LLM с контекстом истории
  - Возвращает ответ ассистента

- `loadHistory()` → `Message[]`
  - Загрузить историю чата из файла
  - Возвращает массив сообщений

- `clearHistory()` → `void`
  - Очистить историю чата

- `loadConfig()` → `Config`
  - Загрузить конфигурацию (для будущего UI настроек)

- `saveConfig(config: Config)` → `void`
  - Сохранить конфигурацию (для будущего UI настроек)

### Zustand Store

```typescript
interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface ChatStore {
  messages: Message[]
  isLoading: boolean
  error: string | null

  addMessage: (message: Message) => void
  setMessages: (messages: Message[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  clearMessages: () => void
}
```

---

## 2. Компоненты

### ChatContainer.tsx

**Ответственность:**
- Главный контейнер чата
- Загрузка истории при монтировании
- Управление layout

**Логика:**
```typescript
useEffect(() => {
  loadHistory()
}, [])

const loadHistory = async () => {
  const history = await conveyor.ai.loadHistory()
  setMessages(history)
}
```

### MessageList.tsx

**Ответственность:**
- Отображение списка сообщений
- Автоматическая прокрутка к последнему сообщению
- Индикатор загрузки

**Использует:**
- Shadcn `ScrollArea` для прокрутки
- Автоскролл при добавлении нового сообщения

### MessageItem.tsx

**Ответственность:**
- Отображение одного сообщения
- Разная стилизация для user/assistant
- Форматирование markdown (через `react-markdown`)

**UI:**
- Выравнивание: user справа, assistant слева
- Shadcn `Badge` для роли (User/AI)
- Timestamp в читаемом формате

### ChatInput.tsx

**Ответственность:**
- Поле ввода сообщения
- Кнопка отправки
- Обработка клавиатурных событий

**Функционал:**
- `Enter` - отправить сообщение
- `Shift+Enter` - новая строка
- Автоматическое увеличение высоты textarea
- Disabled во время загрузки
- Очистка после отправки

**Использует:**
- Shadcn `Button` для отправки
- Textarea с auto-resize

### Замена Welcome Kit

- Удалить компоненты welcome из роутинга
- Главная страница `/` → `ChatContainer`
- Убрать WelcomeKit и связанные компоненты

---

## 3. Поток данных

### Инициализация приложения

```
App запускается
  ↓
ChatContainer монтируется
  ↓
useEffect вызывает conveyor.ai.loadHistory()
  ↓
Main process читает chat-history.json
  ↓
История загружается в Zustand store
  ↓
UI отображает историю
```

### Отправка сообщения

```
User вводит текст и нажимает Enter
  ↓
ChatInput.onSubmit()
  ↓
Zustand store:
  - addMessage({ role: 'user', content })
  - setLoading(true)
  - setError(null)
  ↓
conveyor.ai.sendMessage(content, allMessages)
  ↓
IPC → Main Process (ai-handler)
  ↓
ai-handler:
  1. Загружает config.json
  2. Формирует запрос к OpenRouter API
  3. Отправляет историю + новое сообщение
  4. Ждет полного ответа
  5. Сохраняет обновленную историю в chat-history.json
  6. Возвращает ответ ассистента
  ↓
IPC Response → Renderer Process
  ↓
Zustand store:
  - addMessage({ role: 'assistant', content: response })
  - setLoading(false)
  ↓
MessageList автоматически прокручивается вниз
  ↓
UI показывает новое сообщение
```

### Персистентность

- **Автосохранение:** После каждого ответа AI вся история сохраняется в JSON
- **Загрузка:** При старте приложения история загружается из файла
- **Fallback:** Если файл отсутствует или поврежден - начинаем с пустого массива

---

## 4. Обработка ошибок

### Типы ошибок и решения

**1. Ошибки конфигурации**

Проблемы:
- Отсутствует config.json
- Неверный формат JSON
- Отсутствует API ключ

Решение:
- Проверка при первом запросе к AI
- Понятное сообщение: "Создайте файл config.json по пути {path} с вашим OpenRouter API ключом"
- Показать пример конфигурации

**2. Ошибки OpenRouter API**

Проблемы:
- 401 - неверный API ключ
- 429 - превышен лимит запросов
- 404 - модель не найдена
- Network timeout

Решение:
- Перехват в openrouter.ts сервисе
- Понятные сообщения об ошибках
- Кнопка "Повторить" для повторной отправки
- Логирование в консоль

**3. Ошибки файловой системы**

Проблемы:
- Нет доступа к userData
- Ошибка чтения/записи JSON

Решение:
- Try-catch вокруг fs операций
- Fallback к работе без персистентности
- Уведомление пользователя

**4. Валидация**

Проблемы:
- Пустое сообщение
- Слишком длинное сообщение
- Невалидный JSON в истории

Решение:
- Zod схемы в Conveyor для валидации
- Блокировка кнопки отправки для пустых сообщений
- Sanitization входных данных

### UI для ошибок

- **Системное сообщение:** Ошибки API показываются как сообщение в чате красным цветом
- **Alert компонент:** Критические ошибки (нет конфига) - Shadcn Alert вверху экрана
- **Кнопка повтора:** При временных ошибках показать кнопку "Повторить попытку"
- **Store:** Все ошибки сохраняются в `store.error` для UI

---

## 5. Тестирование

### Ручное тестирование для MVP

**Сценарий 1: Первый запуск**
- [ ] Запустить без config.json
- [ ] Увидеть понятное сообщение с путем к файлу
- [ ] Создать config.json с API ключом
- [ ] Перезапустить - чат работает

**Сценарий 2: Базовая коммуникация**
- [ ] Отправить сообщение "Привет"
- [ ] Увидеть индикатор загрузки
- [ ] Получить ответ от AI
- [ ] Проверить сохранение в chat-history.json

**Сценарий 3: Персистентность**
- [ ] Отправить 3-5 сообщений
- [ ] Закрыть приложение
- [ ] Открыть снова
- [ ] История загружена корректно

**Сценарий 4: Обработка ошибок**
- [ ] Неверный API ключ → понятная ошибка
- [ ] Нет интернета → сообщение о сети
- [ ] Пустое сообщение → кнопка заблокирована

**Сценарий 5: UI/UX**
- [ ] Длинные сообщения корректно отображаются
- [ ] Автоскролл к новым сообщениям
- [ ] Enter отправляет, Shift+Enter - новая строка
- [ ] Textarea растет с текстом

### Инструменты отладки

- Electron DevTools (renderer process)
- Console.log в main process
- Просмотр JSON файлов в userData

### Будущее тестирование

При развитии добавим:
- Unit тесты для OpenRouter сервиса (Vitest)
- Unit тесты для Zustand store
- E2E тесты (Playwright)

---

## 6. Технический стек

**Используемые технологии:**
- Electron 40.1.0 (desktop framework)
- React 19.2.4 (UI framework)
- TypeScript 5.9.3 (type safety)
- Zustand 5.0.11 (state management)
- Zod 4.3.6 (validation)
- Conveyor (type-safe IPC - встроено в шаблон)
- Shadcn UI (компоненты: Button, ScrollArea, Badge, Alert)
- TailwindCSS 4.1.18 (стилизация)
- react-markdown (форматирование сообщений)

**Внешние API:**
- OpenRouter API (https://openrouter.ai/docs)

---

## 7. Следующие шаги после MVP

1. **Streaming ответов**
   - Server-Sent Events (SSE) от OpenRouter
   - Постепенное отображение ответа

2. **UI настроек**
   - Модальное окно или отдельная страница
   - Управление API ключом, моделью, параметрами
   - Сохранение через Conveyor API

3. **Множественные чаты**
   - Sidebar с списком чатов
   - Создание/удаление чатов
   - Переключение между чатами

4. **Работа с кодом**
   - Syntax highlighting
   - Copy code button
   - File context awareness

5. **Универсальный ассистент**
   - Интеграция с файловой системой
   - Code analysis
   - Tool use / Function calling

---

## Критерии успеха MVP

- [ ] Приложение запускается и показывает чат интерфейс
- [ ] Можно отправить сообщение и получить ответ от LLM
- [ ] История сохраняется и восстанавливается между сессиями
- [ ] Ошибки обрабатываются и показываются понятно
- [ ] Конфигурация читается из JSON файла
- [ ] Код структурирован и легко расширяется

---

## Риски и ограничения

**Риски:**
- OpenRouter API может быть недоступен (mitigation: обработка ошибок)
- Большая история может замедлить загрузку (mitigation: в будущем - пагинация)
- API ключ в plain text (mitigation: в будущем - electron-store с encryption)

**Ограничения MVP:**
- Один чат
- Нет streaming
- Нет UI настроек
- Нет работы с файлами/кодом

**Техдолг для будущих версий:**
- Добавить тесты
- Encryption для API ключа
- Миграция на базу данных при росте
- Оптимизация производительности
