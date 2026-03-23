# Дизайн модели памяти (Memory Layers)

**Дата:** 2026-03-02
**День:** 11
**Задача:** Реализовать модель памяти для ассистента с разделением на 3 типа

---

## Обзор

Реализуем явную модель памяти (memory layers) для CLI агента с разделением на три типа:

- **Краткосрочная память** (short-term) - текущий диалог в сессии
- **Рабочая память** (working) - данные текущей активной задачи
- **Долговременная память** (long-term) - профиль пользователя, ограничения, накопленные знания

**Подход:** Минималистичный с явным управлением через команды.

---

## Цели

1. ✅ Разделить информацию на 3+ типа памяти
2. ✅ Хранить разные типы отдельно
3. ✅ Дать явный контроль что и куда сохраняется
4. ✅ Проверить влияние памяти на ответы ассистента

---

## Архитектура

### 1. Файловая структура

```
.memory/
├── short-term/
│   └── current-session.json      # Текущая сессия диалога
├── working/
│   └── active-task.json          # Активная задача
└── long-term/
    ├── profile.json              # Профиль пользователя (стиль, preferences)
    ├── constraints.json          # Ограничения/инварианты
    └── knowledge.json            # Накопленные знания (факты, решения)
```

### 2. Формат данных

**short-term/current-session.json:**
```json
{
  "sessionId": "2026-03-02-23-30",
  "startedAt": "2026-03-02T23:30:00Z",
  "messages": [
    {
      "role": "user",
      "content": "...",
      "timestamp": "..."
    }
  ],
  "tokenCount": 1500
}
```

**working/active-task.json:**
```json
{
  "taskId": "task-123",
  "description": "Реализовать модель памяти",
  "status": "in_progress",
  "context": {
    "files": ["src/memory/manager.ts"],
    "decisions": ["Используем JSON файлы", "Структура из 3 слоев"]
  },
  "startedAt": "2026-03-02T23:00:00Z"
}
```

**long-term/profile.json:**
```json
{
  "style": {
    "responseLength": "detailed",
    "tone": "professional",
    "language": "russian"
  },
  "preferences": {
    "stack": ["TypeScript", "Node.js"],
    "frameworks": ["Ink", "React"]
  }
}
```

**long-term/constraints.json:**
```json
{
  "forbidden": ["Python", "Java"],
  "required": ["TypeScript", "ESLint"],
  "rules": [
    "Всегда использовать функциональный стиль",
    "Избегать any типов"
  ]
}
```

**long-term/knowledge.json:**
```json
{
  "facts": [
    {
      "id": "fact-1",
      "content": "В проекте используется Ink для CLI UI",
      "addedAt": "2026-03-02T20:00:00Z",
      "relevance": "high"
    }
  ],
  "decisions": [
    {
      "id": "decision-1",
      "content": "Решили использовать суммаризацию при 70% заполнения контекста",
      "madeAt": "2026-02-26T...",
      "rationale": "Баланс между памятью и качеством"
    }
  ]
}
```

---

## Компоненты

### Архитектура классов

```
MemoryManager (главный координатор)
├── ShortTermMemory (краткосрочная)
├── WorkingMemory (рабочая)
└── LongTermMemory (долговременная)
    ├── Profile
    ├── Constraints
    └── Knowledge
```

### 1. MemoryManager

Главный класс для управления всеми слоями памяти.

```typescript
class MemoryManager {
  private shortTerm: ShortTermMemory
  private working: WorkingMemory
  private longTerm: LongTermMemory

  // Инициализация всех слоев
  async initialize(): Promise<void>

  // Получить контекст для промпта
  getContextForPrompt(): MemoryContext

  // Доступ к слоям
  getShortTerm(): ShortTermMemory
  getWorking(): WorkingMemory
  getLongTerm(): LongTermMemory

  // Очистка слоев
  async clear(layer?: MemoryLayer): Promise<void>
}
```

### 2. ShortTermMemory

Управление текущей сессией диалога.

```typescript
class ShortTermMemory {
  private sessionFile: string
  private session: SessionData

  // Добавить сообщение
  addMessage(message: Message): void

  // Получить историю
  getMessages(): Message[]

  // Очистить сессию
  clear(): void

  // Сохранить/загрузить
  async save(): Promise<void>
  async load(): Promise<void>
}
```

### 3. WorkingMemory

Управление данными текущей задачи.

```typescript
class WorkingMemory {
  private taskFile: string
  private task: Task | null

  // Установить задачу
  async setTask(task: Task): Promise<void>

  // Получить задачу
  getTask(): Task | null

  // Добавить контекст
  async addContext(key: string, value: any): Promise<void>

  // Завершить задачу
  async completeTask(): Promise<void>

  // Очистить
  async clear(): Promise<void>
}
```

### 4. LongTermMemory

Управление профилем, ограничениями и знаниями.

```typescript
class LongTermMemory {
  private profileFile: string
  private constraintsFile: string
  private knowledgeFile: string

  // Профиль
  getProfile(): Profile
  async updateProfile(key: string, value: any): Promise<void>

  // Ограничения
  getConstraints(): Constraints
  async addConstraint(type: string, value: string): Promise<void>
  async removeConstraint(type: string, value: string): Promise<void>

  // Знания
  async addKnowledge(fact: Fact): Promise<void>
  getKnowledge(): Knowledge

  // Загрузка/сохранение
  async load(): Promise<void>
  async save(): Promise<void>
}
```

### Типы данных

```typescript
interface MemoryContext {
  shortTerm: Message[]
  working: Task | null
  longTerm: {
    profile: Profile
    constraints: Constraints
    knowledge: Fact[]
  }
}

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
}

interface Task {
  taskId: string
  description: string
  status: 'in_progress' | 'completed'
  context: Record<string, any>
  startedAt: string
}

interface Profile {
  style: {
    responseLength: string
    tone: string
    language: string
  }
  preferences: {
    stack: string[]
    frameworks: string[]
  }
}

interface Constraints {
  forbidden: string[]
  required: string[]
  rules: string[]
}

interface Fact {
  id: string
  content: string
  addedAt: string
  relevance: 'high' | 'medium' | 'low'
}
```

---

## Интеграция с агентом

### Изменения в Conversation

```typescript
class Conversation {
  private messages: Message[] = []
  private memoryManager: MemoryManager  // НОВОЕ

  constructor() {
    this.memoryManager = new MemoryManager()
    await this.memoryManager.initialize()
  }

  // Сохранение в short-term
  addUserMessage(content: string): void {
    const message = {
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    }
    this.messages.push(message)
    this.memoryManager.getShortTerm().addMessage(message)
  }

  // Формирование промпта с памятью
  buildPromptWithMemory(): Message[] {
    const memoryContext = this.memoryManager.getContextForPrompt()
    const systemPrompt = this.buildSystemPrompt(memoryContext)

    return [
      { role: 'system', content: systemPrompt },
      ...this.messages
    ]
  }
}
```

### System Prompt с памятью

```typescript
private buildSystemPrompt(context: MemoryContext): string {
  let prompt = "Ты полезный AI ассистент.\n\n"

  // Профиль
  if (context.longTerm.profile) {
    prompt += `# Стиль общения\n`
    prompt += `- Длина ответов: ${context.longTerm.profile.style.responseLength}\n`
    prompt += `- Тон: ${context.longTerm.profile.style.tone}\n`
    prompt += `- Предпочитаемый стек: ${context.longTerm.profile.preferences.stack.join(', ')}\n\n`
  }

  // Ограничения
  if (context.longTerm.constraints.forbidden.length > 0) {
    prompt += `# Ограничения\n`
    prompt += `Запрещено использовать: ${context.longTerm.constraints.forbidden.join(', ')}\n\n`
  }

  // Активная задача
  if (context.working) {
    prompt += `# Текущая задача\n`
    prompt += `${context.working.description}\n`
    prompt += `Контекст: ${JSON.stringify(context.working.context)}\n\n`
  }

  // Важные знания
  const relevantKnowledge = context.longTerm.knowledge.filter(f => f.relevance === 'high')
  if (relevantKnowledge.length > 0) {
    prompt += `# Важная информация о проекте\n`
    relevantKnowledge.forEach(fact => {
      prompt += `- ${fact.content}\n`
    })
  }

  return prompt
}
```

---

## Команды управления

### 1. /memory - просмотр памяти

```bash
/memory                    # Показать всю память
/memory short             # Только краткосрочную
/memory working           # Только рабочую
/memory long              # Только долговременную
/memory clear short       # Очистить слой
/memory stats             # Статистика памяти
```

### 2. /remember - сохранить в долговременную память

```bash
/remember В проекте используется Ink для CLI UI
# Сохраняет факт в knowledge.json
```

Используется для запоминания важной информации о проекте, которая должна учитываться в будущих ответах.

### 3. /task - управление задачами

```bash
/task start Реализовать модель памяти    # Начать задачу
/task context files=src/memory/*.ts      # Добавить контекст
/task done                                # Завершить задачу
/task show                                # Показать текущую задачу
```

Позволяет явно указать текущую задачу, чтобы агент понимал контекст диалога.

### 4. /profile - управление профилем

```bash
/profile set style.tone professional     # Установить тон
/profile set stack TypeScript,Node.js    # Установить стек
/profile show                            # Показать профиль
```

Настройка стиля общения и технологических предпочтений.

### 5. /constraint - управление ограничениями

```bash
/constraint add forbidden Python         # Запретить Python
/constraint add required TypeScript      # Требовать TypeScript
/constraint remove forbidden Python      # Удалить запрет
/constraint list                         # Показать все
```

Установка жестких ограничений (инвариантов) для агента.

### Обновление /help

Добавить секцию "Управление памятью" в help команду с полным описанием всех команд и примерами использования.

---

## Тестирование и проверка влияния

### Сценарий 1: Краткосрочная память

**Цель:** Проверить что агент помнит предыдущие сообщения в сессии.

```
1. User: Меня зовут Антон
2. Assistant: Приятно познакомиться, Антон!
3. User: Как меня зовут?
4. Assistant: Вас зовут Антон

✓ Агент использует short-term память
```

### Сценарий 2: Рабочая память

**Цель:** Проверить что контекст задачи влияет на ответы.

```
Без рабочей памяти:
User: Как реализовать это?
Assistant: Нужно больше контекста...

С рабочей памятью:
User: /task start Добавить команду /memory
User: Как реализовать это?
Assistant: Для реализации команды /memory нужно...

✓ Агент понимает "это" = текущая задача
```

### Сценарий 3: Долговременная память (профиль)

**Цель:** Проверить что профиль влияет на стиль и стек.

```
Без профиля:
User: Напиши функцию для чтения файла
Assistant: [Может предложить Python]

С профилем:
User: /profile set stack TypeScript
User: Напиши функцию для чтения файла
Assistant: [Всегда TypeScript код]

✓ Агент использует указанный стек из профиля
```

### Сценарий 4: Ограничения

**Цель:** Проверить что ограничения блокируют нежелательное.

```
User: /constraint add forbidden Python
User: Напиши скрипт для парсинга JSON
Assistant: [Не предлагает Python, только TypeScript]

✓ Агент соблюдает ограничения
```

### Сценарий 5: Накопленные знания

**Цель:** Проверить что знания используются в ответах.

```
User: /remember В проекте используется Ink для CLI UI
User: Как вывести цветной текст?
Assistant: В вашем проекте с Ink используйте <Text color="green">

✓ Агент учитывает накопленные знания
```

### Метрики оценки

**Количественные:**
- Объем каждого слоя памяти (байты)
- Количество элементов в каждом слое
- Процент ответов, использующих память

**Качественные:**
- Релевантность ответов (используется ли профиль?)
- Соблюдение ограничений (нарушаются ли constraints?)
- Контекстная осведомленность (понимает ли задачу?)

---

## Преимущества подхода

✅ **Простота** - понятная файловая структура, легко отлаживать
✅ **Контроль** - явное управление через команды
✅ **Прозрачность** - видно что и где хранится
✅ **Расширяемость** - легко добавить новые типы памяти
✅ **Соответствие лекции** - реализует концепции Stateful Agent

---

## Возможные расширения

В будущем можно добавить:
- Автоматическое извлечение знаний из диалогов (через LLM анализ)
- Векторный поиск по knowledge базе
- История задач и их результатов
- Экспорт/импорт профилей
- Синхронизация памяти между устройствами

---

## Заключение

Данный дизайн реализует явную модель памяти с разделением на три слоя, каждый из которых хранится отдельно и имеет четкое назначение. Пользователь получает полный контроль над тем, что и куда сохраняется через команды CLI. Система памяти интегрируется с существующим агентом через System Prompt, влияя на стиль и содержание ответов.
