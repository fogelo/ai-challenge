# Дизайн системы инвариантов

**Дата:** 2026-03-05
**Автор:** AI Challenge Day 14
**Цель:** Добавить систему инвариантов и ограничений состояния в CLI агента

## Обзор

Система инвариантов обеспечивает жесткий контроль за соблюдением ограничений, которые агент не имеет права нарушать. Инварианты включают архитектурные решения, технологический стек, бизнес-правила и другие критичные ограничения проекта.

## Подход

Выбран **модульный подход** с четким разделением ответственности:
- Хранение в `.invariants/` как JSON файлы
- Валидация через промпт + LLM валидатор
- При нарушении - отказ с объяснением
- Команды `/invariants` для управления

## Архитектура и компоненты

### 1. InvariantStorage (`src/invariants/InvariantStorage.ts`)
Отвечает за загрузку и сохранение инвариантов из файловой системы.
- Читает `.invariants/*.json`
- Поддерживает дефолтный файл `default.json`
- Может загружать profile-specific инварианты (опционально)

### 2. InvariantValidator (`src/invariants/InvariantValidator.ts`)
Валидирует ответы агента через LLM.
- Делает отдельный API запрос для проверки
- Возвращает structured output: `{valid: boolean, violations: []}`
- Использует быструю модель (например, GPT-4o-mini или Gemini Flash)

### 3. InvariantInjector (`src/invariants/InvariantInjector.ts`)
Умная инжекция инвариантов в промпт.
- Форматирует инварианты для system prompt
- Может инжектить в разные части (system/user message)
- Поддерживает приоритеты (hard/soft invariants)

### 4. InvariantManager (`src/invariants/InvariantManager.ts`)
Координатор, объединяющий все модули.
- Единая точка входа для работы с инвариантами
- Управляет жизненным циклом
- Предоставляет API для команд

### Структура папок
```
src/invariants/
├── InvariantStorage.ts
├── InvariantValidator.ts
├── InvariantInjector.ts
├── InvariantManager.ts
├── types.ts
└── index.ts

.invariants/
└── default.json
```

## Структура данных

### Формат файла `.invariants/default.json`

```json
{
  "version": "1.0",
  "invariants": {
    "stack": {
      "type": "hard",
      "description": "Технологический стек проекта",
      "rules": [
        "Только TypeScript (никакого JavaScript)",
        "React 18+ с хуками",
        "Vite как инструмент сборки"
      ]
    },
    "architecture": {
      "type": "hard",
      "description": "Архитектурные паттерны",
      "rules": [
        "MVI архитектура (Model-View-Intent)",
        "Компонентный дизайн",
        "Только функциональные компоненты"
      ]
    },
    "bans": {
      "type": "hard",
      "description": "Запрещенные технологии и паттерны",
      "rules": [
        "Никаких классовых компонентов",
        "Никакого jQuery или прямой работы с DOM",
        "Никаких inline стилей (использовать CSS modules или styled-components)"
      ]
    },
    "bestPractices": {
      "type": "soft",
      "description": "Рекомендуемые практики",
      "rules": [
        "Предпочитать именованные экспорты",
        "Использовать TypeScript strict mode",
        "Добавлять JSDoc комментарии для сложной логики"
      ]
    }
  }
}
```

### TypeScript типы

```typescript
export type InvariantType = 'hard' | 'soft';

export interface InvariantCategory {
  type: InvariantType;
  description: string;
  rules: string[];
}

export interface InvariantSet {
  version: string;
  invariants: Record<string, InvariantCategory>;
}

export interface ValidationResult {
  valid: boolean;
  violations: {
    category: string;
    rule: string;
    explanation: string;
  }[];
}
```

**Логика типов:**
- `hard` - критичные нарушения, блокируют ответ
- `soft` - предупреждения, показываются но не блокируют

## Поток валидации

```
User Request
     ↓
Load Invariants → Inject into System Prompt
     ↓
Send to LLM (основной запрос)
     ↓
Receive Response
     ↓
Validate Response (отдельный LLM запрос)
     ↓
   Valid?
   ↙    ↘
  YES    NO
   ↓      ↓
Show   Show Violation Error
User   (with explanation)
```

### Промпт валидатора

```typescript
const validatorPrompt = `
Ты валидатор инвариантов. Проверь, нарушает ли ответ агента какие-либо правила.

ИНВАРИАНТЫ:
${formattedInvariants}

ОТВЕТ АГЕНТА:
${agentResponse}

Верни JSON:
{
  "valid": boolean,
  "violations": [
    {
      "category": "stack" | "architecture" | "bans" | "bestPractices",
      "rule": "конкретное нарушенное правило",
      "explanation": "почему это нарушение"
    }
  ]
}

Если нарушений нет, верни {"valid": true, "violations": []}.
`;
```

### Обработка результата

- Если `valid: true` → показываем ответ пользователю
- Если `valid: false` → показываем сообщение об ошибке с деталями нарушений
- `soft` нарушения → показываем предупреждение, но не блокируем
- `hard` нарушения → полностью блокируем ответ

### Сообщение пользователю при нарушении

```
Ответ нарушает инварианты:

[Stack] Только TypeScript (никакого JavaScript)
→ Предложен код на JavaScript вместо TypeScript

[Bans] Никаких классовых компонентов
→ Использован классовый компонент вместо функционального

Пожалуйста, переформулируйте запрос с учетом ограничений.
Используйте /invariants для просмотра всех правил.
```

## Интеграция с существующим кодом

### 1. Создание InvariantManager в Chat.tsx

```typescript
// В начале компонента, после других менеджеров
const [invariantManager] = useState(() => new InvariantManager('.invariants'));

// Загрузка инвариантов при монтировании
useEffect(() => {
  invariantManager.load();
}, []);
```

### 2. Инжекция в system prompt

Модифицируем функцию `buildSystemPrompt` в `Chat.tsx`:

```typescript
function buildSystemPrompt(
  activeSkills: SkillName[],
  invariants?: string
): string | undefined {
  const parts: string[] = [];

  if (activeSkills.length > 0) {
    parts.push(activeSkills.map((name) => SKILLS[name]).join('\n\n---\n\n'));
  }

  if (invariants) {
    parts.push('\n\n## ИНВАРИАНТЫ ПРОЕКТА\n\n' + invariants);
  }

  return parts.length > 0 ? parts.join('') : undefined;
}

// При вызове:
const systemPrompt = buildSystemPrompt(
  activeSkills,
  invariantManager.getFormattedInvariants()
);
```

### 3. Валидация после получения ответа

```typescript
// В обработчике ответа от LLM
const response = await sendMessage(messages, currentModel, systemPrompt);

// Валидация
const validation = await invariantManager.validate(
  response.content,
  currentModel
);

if (!validation.valid) {
  // Показываем ошибку вместо ответа
  setError(invariantManager.formatViolationMessage(validation));
  return;
}

// Если валидация прошла - показываем ответ
conversation.addMessage({ role: 'assistant', content: response.content });
```

## Команды /invariants

### Список команд

```typescript
/invariants              // Показать все активные инварианты
/invariants add          // Добавить новый инвариант (интерактивно)
/invariants remove <id>  // Удалить инвариант по ID
/invariants edit         // Открыть файл в редакторе
/invariants reload       // Перезагрузить из файла
/invariants test <text>  // Протестировать текст на нарушения
```

### Примеры использования

```bash
# Показать все инварианты
> /invariants
Активные инварианты:

[Stack] КРИТИЧНО
- Только TypeScript (никакого JavaScript)
- React 18+ с хуками
- Vite как инструмент сборки

[Architecture] КРИТИЧНО
- MVI архитектура (Model-View-Intent)
- Компонентный дизайн

[Bans] КРИТИЧНО
- Никаких классовых компонентов
- Никакого jQuery или прямой работы с DOM

[BestPractices] РЕКОМЕНДАЦИЯ
- Предпочитать именованные экспорты
- Использовать TypeScript strict mode

# Добавить новый запрет
> /invariants add
Выберите категорию:
1. stack
2. architecture
3. bans
4. bestPractices
> 3

Введите правило:
> Никакого Redux (использовать Context API)

Тип (hard/soft):
> hard

Добавлено в категорию 'bans'

# Тестирование
> /invariants test Создай компонент на jQuery
Нарушения найдены:
[Bans] Никакого jQuery или прямой работы с DOM
→ Упоминается jQuery, которая запрещена
```

## Обработка ошибок и edge cases

### 1. Файл инвариантов не найден

```typescript
// При первом запуске создаем дефолтный файл
if (!fs.existsSync('.invariants/default.json')) {
  await invariantManager.createDefaultFile();
  console.log('Создан файл .invariants/default.json с примерами');
}
```

### 2. Ошибка валидации (LLM недоступен)

```typescript
try {
  const validation = await invariantManager.validate(response, model);
} catch (error) {
  // Если валидатор упал - пропускаем проверку с warning
  console.warn('Предупреждение: валидация инвариантов недоступна');
  // Продолжаем без блокировки
}
```

### 3. Некорректный JSON в файле

```typescript
try {
  const data = JSON.parse(fileContent);
  validateInvariantSchema(data); // Проверка структуры
} catch (error) {
  throw new Error(
    `Ошибка в файле .invariants/default.json: ${error.message}\n` +
    `Используйте /invariants edit для исправления`
  );
}
```

### 4. Конфликт запроса пользователя и инвариантов

```
Пользователь: "Напиши компонент на классах"

Агент (через инварианты в промпте):
"Я не могу написать классовый компонент, так как в проекте действует
ограничение 'Никаких классовых компонентов'.

Могу предложить функциональный компонент с хуками. Подходит?"
```

### 5. Пустой файл инвариантов

```typescript
// Если инвариантов нет - работаем без ограничений
if (Object.keys(invariants.invariants).length === 0) {
  console.log('Инварианты не заданы. Агент работает без ограничений.');
  return null; // Не инжектим в промпт
}
```

### 6. Логирование нарушений

```typescript
// Сохраняем историю нарушений для анализа
invariantManager.logViolation({
  timestamp: Date.now(),
  userQuery: userMessage,
  agentResponse: response,
  violations: validation.violations
});
// Файл: .invariants/violations.log
```

## Преимущества решения

1. **Детерминированность** - агент не может нарушить заданные ограничения
2. **Прозрачность** - пользователь видит причины отказа
3. **Гибкость** - легко добавлять/удалять инварианты через команды или файл
4. **Расширяемость** - модульная архитектура позволяет добавлять новые типы проверок
5. **Независимость** - не требует изменения существующей логики агента
6. **Переносимость** - JSON файлы легко версионировать и шарить между проектами

## Следующие шаги

1. Реализовать типы и интерфейсы (`types.ts`)
2. Реализовать InvariantStorage (чтение/запись JSON)
3. Реализовать InvariantValidator (LLM валидация)
4. Реализовать InvariantInjector (форматирование для промпта)
5. Реализовать InvariantManager (координатор)
6. Интегрировать в Chat.tsx и openrouter.ts
7. Добавить обработчики команд /invariants
8. Создать дефолтный файл .invariants/default.json
9. Протестировать все сценарии

## Критерии успеха

- ✅ Инварианты хранятся отдельно от диалога
- ✅ Агент явно учитывает их в рассуждениях (через system prompt)
- ✅ Агент отказывается предлагать решения, которые их нарушают
- ✅ При конфликте агент объясняет причину отказа
- ✅ Пользователь может управлять инвариантами через команды
