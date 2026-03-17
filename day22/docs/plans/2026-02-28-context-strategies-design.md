# Дизайн: Стратегии управления контекстом

**Дата:** 2026-02-28
**Статус:** Утверждено
**Цель:** Реализовать 3 стратегии управления контекстом (Sliding Window, Sticky Facts, Branching) с возможностью переключения

---

## Обзор

Реализуем систему управления контекстом диалога с тремя различными стратегиями:

1. **Sliding Window** - хранить только последние N сообщений
2. **Sticky Facts** - key-value память важных фактов + последние N сообщений
3. **Branching** - ветвление диалога с checkpoint'ами для A/B тестирования

Цель: сравнить эффективность разных подходов к управлению контекстом на тестовом сценарии (10-15 сообщений).

---

## Архитектура

### Strategy Pattern

Используем паттерн Strategy для инкапсуляции логики управления контекстом.

```
src/strategies/
  ├── IContextStrategy.ts           # Интерфейс стратегии
  ├── SlidingWindowStrategy.ts      # Стратегия 1
  ├── StickyFactsStrategy.ts        # Стратегия 2
  ├── BranchingStrategy.ts          # Стратегия 3
  └── index.ts                      # Экспорты
```

### Интерфейс IContextStrategy

```typescript
interface IContextStrategy {
  // Получить сообщения для отправки в API
  getMessagesForAPI(): Promise<Message[]>

  // Добавить новое сообщение в историю
  addMessage(message: Message): Promise<void>

  // Очистить контекст
  clear(): void

  // Название стратегии для UI
  getName(): string

  // Сериализация состояния для сохранения
  serialize(): StrategyState

  // Восстановление из сохраненного состояния
  restore(state: StrategyState): void
}
```

---

## Типы данных

### Базовые типы

```typescript
type StrategyType = 'sliding' | 'facts' | 'branching'

interface BaseStrategyState {
  type: StrategyType
  messages: Message[]
}
```

### Sliding Window State

```typescript
interface SlidingWindowState extends BaseStrategyState {
  type: 'sliding'
  windowSize: number
}
```

### Sticky Facts State

```typescript
interface StickyFactsState extends BaseStrategyState {
  type: 'facts'
  facts: Record<string, string>  // ключ-значение
  windowSize: number
  lastFactsUpdate: number
}
```

### Branching State

```typescript
interface Checkpoint {
  id: string
  timestamp: number
  messageIndex: number
  name?: string
}

interface Branch {
  id: string
  name: string
  checkpointId: string
  messages: Message[]
  createdAt: number
}

interface BranchingState extends BaseStrategyState {
  type: 'branching'
  checkpoints: Checkpoint[]
  branches: Branch[]
  currentBranchId: string | null
}
```

### Union Type

```typescript
type StrategyState = SlidingWindowState | StickyFactsState | BranchingState
```

---

## Реализация стратегий

### 1. Sliding Window Strategy

**Логика:**
- Храним все сообщения в массиве
- `getMessagesForAPI()` возвращает только последние N
- Обрезка происходит только при получении для API

**Преимущества:**
- Простая и быстрая
- Минимум накладных расходов
- Нет дополнительных API вызовов

**Недостатки:**
- Теряется контекст из ранних сообщений
- Может забыть важные детали

### 2. Sticky Facts Strategy

**Логика:**
- После каждого user message делаем дополнительный LLM вызов для извлечения facts
- Промпт: "Извлеки ключевые факты из диалога в JSON: {ключ: значение}"
- Facts накапливаются (новые перезаписывают старые по ключу)
- `getMessagesForAPI()` возвращает: system message с facts + последние N сообщений

**Извлечение facts:**

```typescript
private async extractFacts(): Promise<void> {
  const extractionPrompt = `Проанализируй диалог и извлеки ключевые факты в JSON формате.
  Ключи: goal, constraints, preferences, decisions, agreements, context.
  Верни только JSON без дополнительного текста.`

  const response = await sendMessage([
    { role: 'system', content: extractionPrompt },
    ...this.messages.slice(-5)
  ], modelId)

  try {
    const newFacts = JSON.parse(response.content)
    this.facts = { ...this.facts, ...newFacts }
  } catch (e) {
    // Graceful degradation - пропускаем при ошибке
  }
}
```

**Формат facts в API запросе:**

```typescript
async getMessagesForAPI(): Promise<Message[]> {
  const factsMessage: Message = {
    role: 'system',
    content: `Важные факты из диалога:\n${JSON.stringify(this.facts, null, 2)}`
  }

  return [
    factsMessage,
    ...this.messages.slice(-this.windowSize)
  ]
}
```

**Преимущества:**
- Сохраняет важные детали из всего диалога
- LLM сам определяет что важно
- Компактное представление ключевой информации

**Недостатки:**
- Дополнительные API вызовы (1 на каждое user message)
- Увеличенная стоимость (~2.5x)
- Зависит от качества извлечения LLM

### 3. Branching Strategy

**Логика:**
- `/checkpoint` создает точку сохранения (индекс в массиве)
- `/branch new "название"` создает новую ветку от последнего checkpoint
- Каждая ветка хранит только свои сообщения после точки ветвления
- `getMessagesForAPI()` возвращает: сообщения до checkpoint + сообщения текущей ветки

**Структура данных:**

```typescript
class BranchingStrategy {
  private baseMessages: Message[] = []
  private checkpoints: Checkpoint[] = []
  private branches: Branch[] = []
  private currentBranchId: string | null = null
}
```

**Создание checkpoint:**

```typescript
createCheckpoint(name?: string): void {
  const checkpoint: Checkpoint = {
    id: generateId(),
    timestamp: Date.now(),
    messageIndex: this.getCurrentMessages().length,
    name
  }
  this.checkpoints.push(checkpoint)
}
```

**Создание ветки:**

```typescript
createBranch(name: string, checkpointId: string): void {
  if (this.checkpoints.length === 0) {
    throw new Error('No checkpoints available')
  }

  const branch: Branch = {
    id: generateId(),
    name,
    checkpointId,
    messages: [],
    createdAt: Date.now()
  }
  this.branches.push(branch)
  this.currentBranchId = branch.id
}
```

**Переключение между ветками:**

```typescript
switchBranch(branchId: string): void {
  const branch = this.branches.find(b => b.id === branchId)
  if (!branch) {
    throw new Error('Branch not found')
  }
  this.currentBranchId = branchId
}
```

**Получение сообщений для API:**

```typescript
async getMessagesForAPI(): Promise<Message[]> {
  if (!this.currentBranchId) {
    return this.baseMessages
  }

  const branch = this.branches.find(b => b.id === this.currentBranchId)
  const checkpoint = this.checkpoints.find(c => c.id === branch?.checkpointId)

  return [
    ...this.baseMessages.slice(0, checkpoint?.messageIndex || 0),
    ...branch?.messages || []
  ]
}
```

**Пример использования:**

```
1-4: базовые сообщения
/checkpoint
/branch new "Вариант А: минимум"
5-6: сообщения в ветке А

/branch new "Вариант Б: полный"
7-8: сообщения в ветке Б

/branch 1  # переключение на ветку А
API получит: сообщения 1-4 + 5-6

/branch 2  # переключение на ветку Б
API получит: сообщения 1-4 + 7-8
```

**Преимущества:**
- A/B тестирование разных подходов
- Ветки полностью изолированы
- Не дублирует общую часть истории

**Недостатки:**
- Сложнее в реализации
- Требует ручного управления (команды)
- Может запутать пользователя

---

## Интеграция с существующим кодом

### Изменения в Conversation

```typescript
class Conversation {
  private strategy: IContextStrategy
  private allMessages: Message[] = []

  constructor(strategy?: IContextStrategy) {
    this.strategy = strategy || new SlidingWindowStrategy(10)
  }

  setStrategy(strategy: IContextStrategy): void {
    this.strategy = strategy
    // Передаем текущие сообщения в новую стратегию
    this.allMessages.forEach(msg => this.strategy.addMessage(msg))
  }

  getStrategy(): IContextStrategy {
    return this.strategy
  }

  async addUserMessage(content: string): Promise<void> {
    const message: Message = { role: 'user', content }
    this.allMessages.push(message)
    await this.strategy.addMessage(message)
  }

  async addAssistantMessage(content: string): Promise<void> {
    const message: Message = { role: 'assistant', content }
    this.allMessages.push(message)
    await this.strategy.addMessage(message)
  }

  async getMessagesForAPI(): Promise<Message[]> {
    return await this.strategy.getMessagesForAPI()
  }

  clear(): void {
    this.allMessages = []
    this.strategy.clear()
  }

  getHistory(): Message[] {
    return this.allMessages
  }
}
```

**Изменения:**
- Добавлено поле `strategy: IContextStrategy`
- Методы `addUserMessage/addAssistantMessage` стали async
- `getMessagesForAPI()` делегирует логику стратегии
- Сохраняем полную историю в `allMessages` для бэкапа

### Новые команды в Chat.tsx

```typescript
// /strategy - список и переключение
if (trimmed === '/strategy') {
  console.log('Available strategies:')
  console.log('1. Sliding Window - last N messages only')
  console.log('2. Sticky Facts - key facts + recent messages')
  console.log('3. Branching - conversation branches')
  return
}

if (trimmed.startsWith('/strategy ')) {
  const num = parseInt(trimmed.split(' ')[1])
  await switchStrategy(num)
  return
}

// /checkpoint - создать точку сохранения (Branching)
if (trimmed === '/checkpoint') {
  const strategy = conversation.getStrategy()
  if (strategy instanceof BranchingStrategy) {
    strategy.createCheckpoint()
    console.log('✓ Checkpoint created')
  } else {
    console.log('⚠ Checkpoints only available in Branching strategy')
  }
  return
}

// /branch - управление ветками
if (trimmed.startsWith('/branch')) {
  await handleBranchCommand(trimmed)
  return
}

// /facts - просмотр извлеченных фактов (Sticky Facts)
if (trimmed === '/facts') {
  const strategy = conversation.getStrategy()
  if (strategy instanceof StickyFactsStrategy) {
    console.log(strategy.getFacts())
  } else {
    console.log('⚠ Facts only available in Sticky Facts strategy')
  }
  return
}
```

### Сохранение/восстановление сессий

**SessionData:**

```typescript
interface SessionData {
  messages: Message[]
  model: string
  timestamp: number
  strategyState: StrategyState  // Добавлено
}
```

**Сохранение:**

```typescript
function saveSession(conversation: Conversation): void {
  const data: SessionData = {
    messages: conversation.getHistory(),
    model: currentModel,
    timestamp: Date.now(),
    strategyState: conversation.getStrategy().serialize()
  }
  fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2))
}
```

**Восстановление:**

```typescript
function loadSession(sessionFile: string): void {
  const data: SessionData = JSON.parse(fs.readFileSync(sessionFile))

  // Восстанавливаем стратегию
  const strategy = createStrategyFromState(data.strategyState)
  conversation.setStrategy(strategy)

  // Восстанавливаем сообщения
  for (const msg of data.messages) {
    if (msg.role === 'user') await conversation.addUserMessage(msg.content)
    if (msg.role === 'assistant') await conversation.addAssistantMessage(msg.content)
  }
}

function createStrategyFromState(state: StrategyState): IContextStrategy {
  switch(state.type) {
    case 'sliding':
      const sliding = new SlidingWindowStrategy(state.windowSize)
      sliding.restore(state)
      return sliding
    case 'facts':
      const facts = new StickyFactsStrategy(state.windowSize)
      facts.restore(state)
      return facts
    case 'branching':
      const branching = new BranchingStrategy()
      branching.restore(state)
      return branching
  }
}
```

---

## Конфигурация

Добавим в `config.json`:

```json
{
  "favoriteModels": [...],
  "currentModel": "...",
  "summarization": {...},
  "strategy": {
    "default": "sliding",
    "slidingWindow": {
      "size": 10
    },
    "stickyFacts": {
      "windowSize": 10,
      "extractionModel": null
    },
    "branching": {
      "maxCheckpoints": 20
    }
  }
}
```

**Параметры:**

- `default` - стратегия по умолчанию при запуске
- `slidingWindow.size` - количество сообщений в окне
- `stickyFacts.windowSize` - количество последних сообщений (помимо facts)
- `stickyFacts.extractionModel` - модель для извлечения facts (null = текущая модель)
- `branching.maxCheckpoints` - лимит на количество checkpoint'ов

---

## Обработка ошибок

### Sticky Facts: провал извлечения

```typescript
private async extractFacts(): Promise<void> {
  try {
    const response = await sendMessage([...], modelId)
    const newFacts = JSON.parse(response.content)
    this.facts = { ...this.facts, ...newFacts }
  } catch (error) {
    console.error('Failed to extract facts:', error.message)
    // Продолжаем с предыдущими facts
  }
}
```

**Стратегия:** Graceful degradation - не прерываем диалог.

### Переключение стратегий

```typescript
const switchStrategy = async (num: number) => {
  try {
    console.log('Switching strategy...')
    const newStrategy = createStrategy(num)

    const messages = conversation.getHistory()
    for (const msg of messages) {
      await newStrategy.addMessage(msg)
    }

    conversation.setStrategy(newStrategy)
    console.log(`✓ Switched to ${newStrategy.getName()}`)
  } catch (error) {
    console.error('Failed to switch strategy:', error.message)
    console.log('Staying on current strategy')
  }
}
```

### Branching: нет checkpoint

```typescript
createBranch(name: string): void {
  if (this.checkpoints.length === 0) {
    throw new Error('No checkpoints available. Create checkpoint first with /checkpoint')
  }
  // ...
}
```

В Chat.tsx ловим и показываем пользователю:

```typescript
try {
  strategy.createBranch(name)
  console.log(`✓ Branch "${name}" created`)
} catch (error) {
  console.error(`⚠ ${error.message}`)
}
```

### Восстановление сессии

```typescript
function loadSession(sessionFile: string): void {
  try {
    const data = JSON.parse(fs.readFileSync(sessionFile))

    if (!data.strategyState) {
      console.warn('Session has no strategy state, using default')
      data.strategyState = { type: 'sliding', messages: [], windowSize: 10 }
    }

    const strategy = createStrategyFromState(data.strategyState)
    conversation.setStrategy(strategy)
  } catch (error) {
    console.error('Failed to load session:', error.message)
    console.log('Starting fresh session')
  }
}
```

---

## План тестирования

### Тестовый сценарий "Сбор ТЗ на веб-проект"

15 сообщений:

1. "Помоги собрать ТЗ на веб-проект"
2. "Какой тип проекта?"
3. "Интернет-магазин электроники"
4. "Какой функционал нужен?"
5. "Каталог, корзина, оплата, личный кабинет"
6. "Есть ли ограничения по бюджету?"
7. "До $10,000"
8. "Какие сроки?"
9. "3 месяца на разработку"
10. "Какие технологии предпочитаете?"
11. "React, Node.js, PostgreSQL"
12. "Нужна ли интеграция с платежными системами?"
13. "Да, Stripe и PayPal"
14. "Какие требования к дизайну?"
15. "Минимализм, адаптивность под мобильные"

### Метрики для сравнения

| Метрика | Sliding Window | Sticky Facts | Branching |
|---------|---------------|--------------|-----------|
| Токенов в запросе | ~800 (10 msg) | ~900 (facts + 10) | ~800 (зависит от ветки) |
| Качество контекста | Теряет старые детали | Сохраняет ключевые facts | Можно сравнить варианты |
| Доп. API вызовы | 0 | 15 (по 1 на user msg) | 0 |
| Примерная стоимость | $0.05 | $0.12 | $0.05 |

### Сценарии тестирования

**1. Тест каждой стратегии:**

```bash
# Sliding Window
npm start
/strategy 1
<провести полный сценарий>
/stats

# Sticky Facts
npm start
/strategy 2
<провести полный сценарий>
/facts
/stats

# Branching
npm start
/strategy 3
<до сообщения 8>
/checkpoint
/branch new "Быстрый срок"
<продолжить вариант А>
/branch new "Качество превыше"
<продолжить вариант Б>
/branch list
/stats
```

**2. Тест сохранения/восстановления:**

```bash
/strategy 2
<несколько сообщений>
Ctrl+C

npm start
/resume 1
/facts  # проверить восстановление facts
```

**3. Тест переключения:**

```bash
npm start
<10 сообщений>
/strategy 1
<5 сообщений>
/strategy 2
/facts  # должны быть facts из всех 15 сообщений
```

### Верификация

Создать документ `docs/testing/2026-02-28-context-strategies-verification.md` с:

- Результатами `/stats` для каждой стратегии
- Таблицей сравнения токенов и стоимости
- Примерами извлеченных facts
- Скриншотами работы с ветками

---

## Оценка объема работ

**Новые файлы:**

```
src/strategies/IContextStrategy.ts          ~40 строк
src/strategies/SlidingWindowStrategy.ts     ~80 строк
src/strategies/StickyFactsStrategy.ts       ~150 строк
src/strategies/BranchingStrategy.ts         ~200 строк
src/strategies/index.ts                     ~10 строк
```

**Изменения в существующих файлах:**

```
src/types/index.ts                          +100 строк
src/chat/conversation.ts                    ~50 строк изменений
src/chat/session.ts                         ~30 строк изменений
src/components/Chat.tsx                     ~100 строк изменений
config.json                                 +15 строк
```

**Итого:**
- ~480 строк нового кода в стратегиях
- ~280 строк изменений в существующем коде
- ~760 строк всего

---

## Критерии успеха

1. ✅ Все 3 стратегии реализованы и работают
2. ✅ Переключение между стратегиями работает корректно
3. ✅ Сохранение/восстановление сессий работает для всех стратегий
4. ✅ Sticky Facts корректно извлекает и использует facts
5. ✅ Branching позволяет создавать и переключаться между ветками
6. ✅ Существующая статистика по токенам продолжает работать
7. ✅ Обработка ошибок не ломает основной диалог
8. ✅ Проведено тестирование на сценарии "Сбор ТЗ"
9. ✅ Создан verification документ с результатами

---

## Следующие шаги

1. Создать implementation plan через writing-plans skill
2. Реализовать базовую инфраструктуру (интерфейс, типы)
3. Реализовать Sliding Window (самая простая)
4. Реализовать Sticky Facts (самая сложная)
5. Реализовать Branching
6. Интегрировать с Conversation и Chat.tsx
7. Добавить сохранение/восстановление
8. Провести тестирование
9. Задокументировать результаты
