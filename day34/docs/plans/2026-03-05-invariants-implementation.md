# Invariants System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Добавить систему инвариантов и ограничений состояния в CLI агента для контроля за соблюдением технических ограничений

**Architecture:** Модульная система из 4 компонентов: Storage (загрузка JSON), Validator (LLM проверка), Injector (форматирование для промпта), Manager (координатор). Интеграция в существующий Chat.tsx через system prompt и post-response валидацию.

**Tech Stack:** TypeScript, Node.js fs/promises, OpenRouter API для валидации, существующий sendMessage

---

## Task 1: Создать типы и интерфейсы

**Files:**
- Create: `src/invariants/types.ts`
- Create: `src/invariants/index.ts`

**Step 1: Создать файл типов**

```typescript
// src/invariants/types.ts

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

export interface Violation {
  category: string;
  rule: string;
  explanation: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
}
```

**Step 2: Создать index файл**

```typescript
// src/invariants/index.ts

export * from './types.js';
export { InvariantStorage } from './InvariantStorage.js';
export { InvariantValidator } from './InvariantValidator.js';
export { InvariantInjector } from './InvariantInjector.js';
export { InvariantManager } from './InvariantManager.js';
```

**Step 3: Проверить компиляцию**

Run: `npm run build`
Expected: SUCCESS, файлы скомпилированы

**Step 4: Commit**

```bash
git add src/invariants/types.ts src/invariants/index.ts
git commit -m "feat(invariants): add types and interfaces"
```

---

## Task 2: Реализовать InvariantStorage

**Files:**
- Create: `src/invariants/InvariantStorage.ts`

**Step 1: Создать класс InvariantStorage**

```typescript
// src/invariants/InvariantStorage.ts

import fs from 'fs/promises';
import path from 'path';
import { InvariantSet } from './types.js';

export class InvariantStorage {
  private invariantsDir: string;
  private defaultFile: string;

  constructor(invariantsDir: string = '.invariants') {
    this.invariantsDir = invariantsDir;
    this.defaultFile = path.join(invariantsDir, 'default.json');
  }

  async load(): Promise<InvariantSet> {
    try {
      // Проверяем существование директории
      await fs.mkdir(this.invariantsDir, { recursive: true });

      // Проверяем существование файла
      try {
        await fs.access(this.defaultFile);
      } catch {
        // Файл не существует, создаем дефолтный
        await this.createDefaultFile();
      }

      // Читаем файл
      const content = await fs.readFile(this.defaultFile, 'utf-8');
      const data = JSON.parse(content);

      // Валидация структуры
      this.validateSchema(data);

      return data;
    } catch (error) {
      throw new Error(
        `Ошибка загрузки инвариантов: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async save(invariants: InvariantSet): Promise<void> {
    try {
      await fs.mkdir(this.invariantsDir, { recursive: true });
      const content = JSON.stringify(invariants, null, 2);
      await fs.writeFile(this.defaultFile, content, 'utf-8');
    } catch (error) {
      throw new Error(
        `Ошибка сохранения инвариантов: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async createDefaultFile(): Promise<void> {
    const defaultInvariants: InvariantSet = {
      version: '1.0',
      invariants: {
        stack: {
          type: 'hard',
          description: 'Технологический стек проекта',
          rules: [
            'Только TypeScript (никакого JavaScript)',
            'React 18+ с хуками',
            'Vite как инструмент сборки',
          ],
        },
        architecture: {
          type: 'hard',
          description: 'Архитектурные паттерны',
          rules: [
            'MVI архитектура (Model-View-Intent)',
            'Компонентный дизайн',
            'Только функциональные компоненты',
          ],
        },
        bans: {
          type: 'hard',
          description: 'Запрещенные технологии и паттерны',
          rules: [
            'Никаких классовых компонентов',
            'Никакого jQuery или прямой работы с DOM',
            'Никаких inline стилей (использовать CSS modules или styled-components)',
          ],
        },
        bestPractices: {
          type: 'soft',
          description: 'Рекомендуемые практики',
          rules: [
            'Предпочитать именованные экспорты',
            'Использовать TypeScript strict mode',
            'Добавлять JSDoc комментарии для сложной логики',
          ],
        },
      },
    };

    await this.save(defaultInvariants);
  }

  private validateSchema(data: any): void {
    if (!data || typeof data !== 'object') {
      throw new Error('Инварианты должны быть объектом');
    }

    if (!data.version || typeof data.version !== 'string') {
      throw new Error('Отсутствует поле version');
    }

    if (!data.invariants || typeof data.invariants !== 'object') {
      throw new Error('Отсутствует поле invariants');
    }

    // Проверяем структуру каждой категории
    for (const [category, value] of Object.entries(data.invariants)) {
      if (!value || typeof value !== 'object') {
        throw new Error(`Категория ${category} должна быть объектом`);
      }

      const cat = value as any;

      if (!cat.type || (cat.type !== 'hard' && cat.type !== 'soft')) {
        throw new Error(`Категория ${category}: type должен быть 'hard' или 'soft'`);
      }

      if (!cat.description || typeof cat.description !== 'string') {
        throw new Error(`Категория ${category}: отсутствует description`);
      }

      if (!Array.isArray(cat.rules)) {
        throw new Error(`Категория ${category}: rules должен быть массивом`);
      }
    }
  }
}
```

**Step 2: Проверить компиляцию**

Run: `npm run build`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add src/invariants/InvariantStorage.ts
git commit -m "feat(invariants): implement storage layer"
```

---

## Task 3: Реализовать InvariantInjector

**Files:**
- Create: `src/invariants/InvariantInjector.ts`

**Step 1: Создать класс InvariantInjector**

```typescript
// src/invariants/InvariantInjector.ts

import { InvariantSet, InvariantCategory } from './types.js';

export class InvariantInjector {
  formatForPrompt(invariants: InvariantSet): string | null {
    const categories = Object.entries(invariants.invariants);

    if (categories.length === 0) {
      return null;
    }

    const formatted = categories
      .map(([category, data]) => this.formatCategory(category, data))
      .join('\n\n');

    return `## ИНВАРИАНТЫ ПРОЕКТА\n\nЭто жесткие ограничения проекта, которые НЕЛЬЗЯ нарушать.\n\n${formatted}`;
  }

  private formatCategory(name: string, category: InvariantCategory): string {
    const priority = category.type === 'hard' ? 'КРИТИЧНО' : 'РЕКОМЕНДАЦИЯ';
    const rules = category.rules.map((rule) => `- ${rule}`).join('\n');

    return `[${name}] ${priority}\n${category.description}\n${rules}`;
  }

  formatViolationMessage(violations: Array<{
    category: string;
    rule: string;
    explanation: string;
  }>): string {
    const messages = violations
      .map(
        (v) =>
          `\n[${v.category}] ${v.rule}\n→ ${v.explanation}`
      )
      .join('\n');

    return `❌ Ответ нарушает инварианты:${messages}\n\nПожалуйста, переформулируйте запрос с учетом ограничений.\nИспользуйте /invariants для просмотра всех правил.`;
  }
}
```

**Step 2: Проверить компиляцию**

Run: `npm run build`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add src/invariants/InvariantInjector.ts
git commit -m "feat(invariants): implement prompt injector"
```

---

## Task 4: Реализовать InvariantValidator

**Files:**
- Create: `src/invariants/InvariantValidator.ts`

**Step 1: Создать класс InvariantValidator**

```typescript
// src/invariants/InvariantValidator.ts

import { sendMessage } from '../api/openrouter.js';
import { InvariantSet, ValidationResult } from './types.js';
import { InvariantInjector } from './InvariantInjector.js';

export class InvariantValidator {
  private injector: InvariantInjector;

  constructor() {
    this.injector = new InvariantInjector();
  }

  async validate(
    agentResponse: string,
    invariants: InvariantSet,
    validatorModel: string
  ): Promise<ValidationResult> {
    try {
      const formattedInvariants = this.injector.formatForPrompt(invariants);

      if (!formattedInvariants) {
        // Нет инвариантов - всегда valid
        return { valid: true, violations: [] };
      }

      const validatorPrompt = this.buildValidatorPrompt(
        formattedInvariants,
        agentResponse
      );

      const response = await sendMessage(
        [{ role: 'user', content: validatorPrompt }],
        validatorModel,
        undefined,
        0 // temperature = 0 для детерминированности
      );

      // Парсим JSON ответ
      const result = this.parseValidationResponse(response.content);
      return result;
    } catch (error) {
      console.warn(
        `Предупреждение: валидация инвариантов недоступна: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      // В случае ошибки пропускаем валидацию
      return { valid: true, violations: [] };
    }
  }

  private buildValidatorPrompt(
    formattedInvariants: string,
    agentResponse: string
  ): string {
    return `Ты валидатор инвариантов. Проверь, нарушает ли ответ агента какие-либо правила.

${formattedInvariants}

ОТВЕТ АГЕНТА:
${agentResponse}

Верни JSON в формате:
{
  "valid": boolean,
  "violations": [
    {
      "category": "название_категории",
      "rule": "конкретное нарушенное правило",
      "explanation": "почему это нарушение"
    }
  ]
}

Если нарушений нет, верни {"valid": true, "violations": []}.
Ответь ТОЛЬКО JSON, без дополнительного текста.`;
  }

  private parseValidationResponse(response: string): ValidationResult {
    try {
      // Пытаемся извлечь JSON из ответа
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('JSON не найден в ответе');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (typeof parsed.valid !== 'boolean') {
        throw new Error('Поле valid должно быть boolean');
      }

      if (!Array.isArray(parsed.violations)) {
        throw new Error('Поле violations должно быть массивом');
      }

      return parsed as ValidationResult;
    } catch (error) {
      throw new Error(
        `Ошибка парсинга ответа валидатора: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
```

**Step 2: Проверить компиляцию**

Run: `npm run build`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add src/invariants/InvariantValidator.ts
git commit -m "feat(invariants): implement LLM validator"
```

---

## Task 5: Реализовать InvariantManager

**Files:**
- Create: `src/invariants/InvariantManager.ts`

**Step 1: Создать класс InvariantManager**

```typescript
// src/invariants/InvariantManager.ts

import { InvariantStorage } from './InvariantStorage.js';
import { InvariantValidator } from './InvariantValidator.js';
import { InvariantInjector } from './InvariantInjector.js';
import { InvariantSet, ValidationResult, Violation } from './types.js';

export class InvariantManager {
  private storage: InvariantStorage;
  private validator: InvariantValidator;
  private injector: InvariantInjector;
  private invariants: InvariantSet | null = null;

  constructor(invariantsDir: string = '.invariants') {
    this.storage = new InvariantStorage(invariantsDir);
    this.validator = new InvariantValidator();
    this.injector = new InvariantInjector();
  }

  async load(): Promise<void> {
    this.invariants = await this.storage.load();
  }

  async reload(): Promise<void> {
    await this.load();
  }

  async save(invariants: InvariantSet): Promise<void> {
    await this.storage.save(invariants);
    this.invariants = invariants;
  }

  getFormattedInvariants(): string | null {
    if (!this.invariants) {
      return null;
    }
    return this.injector.formatForPrompt(this.invariants);
  }

  async validate(
    agentResponse: string,
    validatorModel: string
  ): Promise<ValidationResult> {
    if (!this.invariants) {
      return { valid: true, violations: [] };
    }

    return await this.validator.validate(
      agentResponse,
      this.invariants,
      validatorModel
    );
  }

  formatViolationMessage(validation: ValidationResult): string {
    return this.injector.formatViolationMessage(validation.violations);
  }

  getInvariants(): InvariantSet | null {
    return this.invariants;
  }

  async addRule(
    category: string,
    rule: string,
    type: 'hard' | 'soft' = 'hard'
  ): Promise<void> {
    if (!this.invariants) {
      await this.load();
    }

    if (!this.invariants) {
      throw new Error('Не удалось загрузить инварианты');
    }

    if (!this.invariants.invariants[category]) {
      throw new Error(`Категория ${category} не найдена`);
    }

    this.invariants.invariants[category].rules.push(rule);
    await this.save(this.invariants);
  }

  async removeRule(category: string, ruleIndex: number): Promise<void> {
    if (!this.invariants) {
      await this.load();
    }

    if (!this.invariants) {
      throw new Error('Не удалось загрузить инварианты');
    }

    if (!this.invariants.invariants[category]) {
      throw new Error(`Категория ${category} не найдена`);
    }

    const rules = this.invariants.invariants[category].rules;
    if (ruleIndex < 0 || ruleIndex >= rules.length) {
      throw new Error(`Индекс ${ruleIndex} вне диапазона`);
    }

    rules.splice(ruleIndex, 1);
    await this.save(this.invariants);
  }
}
```

**Step 2: Проверить компиляцию**

Run: `npm run build`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add src/invariants/InvariantManager.ts
git commit -m "feat(invariants): implement manager coordinator"
```

---

## Task 6: Интегрировать в Chat.tsx

**Files:**
- Modify: `src/components/Chat.tsx:1-30` (imports и начало компонента)
- Modify: `src/components/Chat.tsx:24-27` (функция buildSystemPrompt)
- Modify: `src/components/Chat.tsx` (обработчик отправки сообщений)

**Step 1: Добавить импорты**

```typescript
// В начало файла src/components/Chat.tsx, после существующих импортов
import { InvariantManager } from '../invariants/index.js';
```

**Step 2: Создать InvariantManager в компоненте**

```typescript
// После строки 22 (после других useState), добавить:
const [invariantManager] = useState(() => new InvariantManager('.invariants'));
const [invariantsLoaded, setInvariantsLoaded] = useState(false);
```

**Step 3: Загрузить инварианты при монтировании**

```typescript
// Добавить новый useEffect после существующих useEffect
useEffect(() => {
  const loadInvariants = async () => {
    try {
      await invariantManager.load();
      setInvariantsLoaded(true);
    } catch (error) {
      console.error('Ошибка загрузки инвариантов:', error);
      // Продолжаем без инвариантов
      setInvariantsLoaded(true);
    }
  };
  loadInvariants();
}, []);
```

**Step 4: Модифицировать buildSystemPrompt**

```typescript
// Заменить функцию buildSystemPrompt (строки 24-27)
function buildSystemPrompt(
  activeSkills: SkillName[],
  invariants?: string | null
): string | undefined {
  const parts: string[] = [];

  if (activeSkills.length > 0) {
    parts.push(activeSkills.map((name) => SKILLS[name]).join('\n\n---\n\n'));
  }

  if (invariants) {
    parts.push('\n\n' + invariants);
  }

  return parts.length > 0 ? parts.join('') : undefined;
}
```

**Step 5: Проверить компиляцию**

Run: `npm run build`
Expected: SUCCESS

**Step 6: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(invariants): integrate manager into Chat component"
```

---

## Task 7: Добавить валидацию в обработчик сообщений

**Files:**
- Modify: `src/components/Chat.tsx` (функция handleInput, где вызывается sendMessage)

**Step 1: Найти место вызова sendMessage**

Найдите в Chat.tsx место, где вызывается `sendMessage` и добавляется ответ в conversation.
Обычно это выглядит примерно так:

```typescript
const response = await sendMessage(messages, currentModel, systemPrompt);
conversation.addMessage({ role: 'assistant', content: response.content });
```

**Step 2: Добавить валидацию после получения ответа**

Замените код выше на:

```typescript
// Получаем инварианты для system prompt
const formattedInvariants = invariantManager.getFormattedInvariants();
const systemPrompt = buildSystemPrompt(activeSkills, formattedInvariants);

// Отправляем запрос
const response = await sendMessage(messages, currentModel, systemPrompt);

// Валидация ответа на соответствие инвариантам
if (invariantsLoaded) {
  const validation = await invariantManager.validate(
    response.content,
    currentModel
  );

  if (!validation.valid) {
    // Показываем ошибку вместо ответа
    const errorMessage = invariantManager.formatViolationMessage(validation);
    conversation.addMessage({
      role: 'assistant',
      content: errorMessage,
    });
    return;
  }
}

// Если валидация прошла - добавляем ответ
conversation.addMessage({ role: 'assistant', content: response.content });
```

**Step 3: Проверить компиляцию**

Run: `npm run build`
Expected: SUCCESS

**Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(invariants): add response validation"
```

---

## Task 8: Добавить команду /invariants

**Files:**
- Modify: `src/components/Chat.tsx` (обработчик команд, где обрабатываются /model, /clear и т.д.)

**Step 1: Добавить обработчик команды /invariants**

В функции обработки команд (где switch или if/else для команд), добавить:

```typescript
// После обработки других команд, добавить:
if (input.startsWith('/invariants')) {
  const args = input.split(' ').slice(1);
  await handleInvariantsCommand(args);
  return;
}
```

**Step 2: Создать функцию handleInvariantsCommand**

Добавить перед функцией Chat:

```typescript
async function handleInvariantsCommand(
  args: string[],
  invariantManager: InvariantManager,
  setOutput: (output: string) => void
): Promise<void> {
  const command = args[0];

  if (!command) {
    // Показать все инварианты
    const invariants = invariantManager.getInvariants();
    if (!invariants || Object.keys(invariants.invariants).length === 0) {
      setOutput('Инварианты не заданы. Агент работает без ограничений.');
      return;
    }

    let output = '📋 Активные инварианты:\n\n';
    for (const [category, data] of Object.entries(invariants.invariants)) {
      const priority = data.type === 'hard' ? 'КРИТИЧНО' : 'РЕКОМЕНДАЦИЯ';
      output += `[${category}] ${priority}\n`;
      output += `${data.description}\n`;
      data.rules.forEach((rule) => {
        output += `- ${rule}\n`;
      });
      output += '\n';
    }
    setOutput(output);
    return;
  }

  if (command === 'reload') {
    try {
      await invariantManager.reload();
      setOutput('✅ Инварианты перезагружены из файла');
    } catch (error) {
      setOutput(
        `❌ Ошибка перезагрузки: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
    return;
  }

  if (command === 'test') {
    const testText = args.slice(1).join(' ');
    if (!testText) {
      setOutput('Использование: /invariants test <текст для проверки>');
      return;
    }

    try {
      const validation = await invariantManager.validate(
        testText,
        'google/gemini-flash-1.5' // Быстрая модель для теста
      );

      if (validation.valid) {
        setOutput('✅ Нарушений не найдено');
      } else {
        const message = invariantManager.formatViolationMessage(validation);
        setOutput(message);
      }
    } catch (error) {
      setOutput(
        `❌ Ошибка валидации: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
    return;
  }

  setOutput(
    'Доступные команды:\n' +
      '/invariants - показать все инварианты\n' +
      '/invariants reload - перезагрузить из файла\n' +
      '/invariants test <текст> - протестировать текст на нарушения'
  );
}
```

**Step 3: Подключить функцию в компоненте**

В месте вызова команды обновить:

```typescript
if (input.startsWith('/invariants')) {
  const args = input.split(' ').slice(1);
  await handleInvariantsCommand(args, invariantManager, setOutput);
  return;
}
```

**Step 4: Проверить компиляцию**

Run: `npm run build`
Expected: SUCCESS

**Step 5: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(invariants): add /invariants command"
```

---

## Task 9: Создать дефолтный файл инвариантов

**Files:**
- Create: `.invariants/default.json` (будет создан автоматически при первом запуске)

**Step 1: Запустить приложение**

Run: `npm start`
Expected: Приложение запускается, создается файл `.invariants/default.json`

**Step 2: Проверить созданный файл**

Run: `cat .invariants/default.json`
Expected: JSON с дефолтными инвариантами

**Step 3: Добавить .invariants в .gitignore**

Добавить в `.gitignore`:

```
.invariants/
```

**Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: add .invariants to gitignore"
```

---

## Task 10: Протестировать систему

**Files:**
- Test: Запустить приложение и проверить все сценарии

**Step 1: Тест 1 - Просмотр инвариантов**

Run: `npm start`, затем команда `/invariants`
Expected: Показывает список всех категорий и правил

**Step 2: Тест 2 - Валидация с нарушением**

Run: команда `/invariants test Напиши компонент на jQuery`
Expected: ❌ Нарушения найдены: [Bans] Никакого jQuery...

**Step 3: Тест 3 - Валидация без нарушения**

Run: команда `/invariants test Напиши функциональный компонент на TypeScript`
Expected: ✅ Нарушений не найдено

**Step 4: Тест 4 - Реальный запрос с нарушением**

Run: `Напиши классовый компонент для формы логина`
Expected: Агент либо отказывается (через промпт), либо ответ блокируется валидатором

**Step 5: Тест 5 - Перезагрузка**

Run: Отредактировать `.invariants/default.json` вручную, затем `/invariants reload`
Expected: ✅ Инварианты перезагружены

**Step 6: Документировать результаты**

Create: `docs/testing/invariants-test-results.md`

```markdown
# Результаты тестирования системы инвариантов

Дата: 2026-03-05

## Тест 1: Просмотр инвариантов
- Команда: `/invariants`
- Результат: [ПРОЙДЕН/НЕ ПРОЙДЕН]
- Примечания:

## Тест 2: Валидация с нарушением
- Команда: `/invariants test Напиши компонент на jQuery`
- Результат: [ПРОЙДЕН/НЕ ПРОЙДЕН]
- Примечания:

## Тест 3: Валидация без нарушения
- Команда: `/invariants test Напиши функциональный компонент`
- Результат: [ПРОЙДЕН/НЕ ПРОЙДЕН]
- Примечания:

## Тест 4: Реальный запрос с нарушением
- Запрос: "Напиши классовый компонент"
- Результат: [ПРОЙДЕН/НЕ ПРОЙДЕН]
- Примечания:

## Тест 5: Перезагрузка
- Команда: `/invariants reload`
- Результат: [ПРОЙДЕН/НЕ ПРОЙДЕН]
- Примечания:
```

**Step 7: Commit результатов**

```bash
git add docs/testing/invariants-test-results.md
git commit -m "test(invariants): add test results documentation"
```

---

## Task 11: Обновить README

**Files:**
- Modify: `README.md`

**Step 1: Добавить секцию об инвариантах**

Добавить в `README.md` после секции Task State Machine:

```markdown
## Система инвариантов

Агент поддерживает жесткие ограничения (инварианты), которые он не может нарушать.

### Что такое инварианты

Инварианты — это правила проекта, которые должны соблюдаться всегда:
- Технологический стек
- Архитектурные паттерны
- Запрещенные технологии
- Рекомендуемые практики

### Управление инвариантами

- `/invariants` - показать все активные инварианты
- `/invariants reload` - перезагрузить из файла
- `/invariants test <текст>` - протестировать текст на нарушения

### Типы инвариантов

- **hard (критичные)** - нарушения блокируют ответ агента
- **soft (рекомендации)** - показываются предупреждения

### Пример

```bash
> /invariants
Активные инварианты:

[Stack] КРИТИЧНО
- Только TypeScript (никакого JavaScript)
- React 18+ с хуками

[Bans] КРИТИЧНО
- Никаких классовых компонентов
- Никакого jQuery

> Напиши классовый компонент
❌ Ответ нарушает инварианты:
[Bans] Никаких классовых компонентов
→ Предложен классовый компонент
```

### Настройка

Инварианты хранятся в `.invariants/default.json`. Редактируйте файл напрямую или используйте команды для управления.
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add invariants section to README"
```

---

## Task 12: Финальная проверка

**Step 1: Проверить все файлы созданы**

Run: `ls -R src/invariants/`
Expected:
```
InvariantInjector.ts
InvariantManager.ts
InvariantStorage.ts
InvariantValidator.ts
index.ts
types.ts
```

**Step 2: Проверить компиляцию**

Run: `npm run build`
Expected: SUCCESS, без ошибок

**Step 3: Запустить приложение**

Run: `npm start`
Expected: Приложение запускается без ошибок

**Step 4: Проверить git status**

Run: `git status`
Expected: Working tree clean или только untracked .invariants/

**Step 5: Создать финальный commit**

```bash
git add -A
git commit -m "feat(invariants): complete system implementation

Реализована полная система инвариантов:
- InvariantStorage для загрузки/сохранения
- InvariantValidator для LLM валидации
- InvariantInjector для форматирования
- InvariantManager как координатор
- Интеграция в Chat.tsx
- Команды /invariants
- Документация и тесты

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Критерии успеха

- ✅ Все файлы созданы и компилируются
- ✅ Инварианты загружаются при старте
- ✅ Инварианты инжектятся в system prompt
- ✅ Валидация работает после каждого ответа
- ✅ При нарушении показывается понятное сообщение
- ✅ Команды /invariants работают
- ✅ Дефолтный файл создается автоматически
- ✅ Документация обновлена
- ✅ Все тесты пройдены

## Следующие шаги (опционально)

1. Добавить команды `/invariants add` и `/invariants remove` для интерактивного управления
2. Добавить логирование нарушений в `.invariants/violations.log`
3. Добавить поддержку profile-specific инвариантов
4. Добавить UI для редактирования инвариантов через TUI
5. Оптимизировать валидацию (кэширование, батчинг)
