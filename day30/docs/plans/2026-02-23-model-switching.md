# Model Switching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `/model` command to switch between OpenRouter models with dynamic pricing from API

**Architecture:** Model Registry fetches all models from OpenRouter API at startup, Config Manager persists user's favorite models and current selection to config.json, Chat component uses these for model switching and cost calculation.

**Tech Stack:** TypeScript, OpenRouter API, Node.js fs for config persistence

---

## Task 1: Add TypeScript Types

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Add model-related types**

Add to `src/types/index.ts` after existing types:

```typescript
/**
 * OpenRouter model information from /api/v1/models endpoint
 */
export interface ModelInfo {
  id: string;
  name: string;
  pricing: {
    prompt: string;      // price per token in USD
    completion: string;  // price per token in USD
  };
  context_length?: number;
}

/**
 * OpenRouter models API response
 */
export interface ModelsApiResponse {
  data: ModelInfo[];
}

/**
 * User's model configuration stored in config.json
 */
export interface ModelConfig {
  currentModel: string;
  favoriteModels: string[];
}
```

**Step 2: Commit types**

```bash
git add src/types/index.ts
git commit -m "feat: add model types for model switching"
```

---

## Task 2: Create Model Registry

**Files:**
- Create: `src/models/registry.ts`

**Step 1: Create registry class skeleton**

Create `src/models/registry.ts`:

```typescript
import { ModelInfo, ModelsApiResponse, UsageInfo } from '../types/index.js';

export class ModelRegistry {
  private models: Map<string, ModelInfo> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    // TODO
  }

  getModel(id: string): ModelInfo | undefined {
    return this.models.get(id);
  }

  getAllModels(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  calculateCost(modelId: string, usage: UsageInfo): number {
    // TODO
    return 0;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
```

**Step 2: Implement initialize method**

Replace `initialize()` in `src/models/registry.ts`:

```typescript
async initialize(): Promise<void> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data: ModelsApiResponse = await response.json();

    for (const model of data.data) {
      this.models.set(model.id, model);
    }

    this.initialized = true;
  } catch (error) {
    console.error('Failed to load models from OpenRouter:', error);
    // Fallback: add Claude 3.5 Sonnet with hardcoded prices
    this.models.set('anthropic/claude-3.5-sonnet', {
      id: 'anthropic/claude-3.5-sonnet',
      name: 'Claude 3.5 Sonnet',
      pricing: {
        prompt: '0.000003',
        completion: '0.000015',
      },
    });
    this.initialized = true;
  }
}
```

**Step 3: Implement calculateCost method**

Replace `calculateCost()` in `src/models/registry.ts`:

```typescript
calculateCost(modelId: string, usage: UsageInfo): number {
  const model = this.models.get(modelId);

  if (!model || !model.pricing) {
    return 0;
  }

  const promptPrice = parseFloat(model.pricing.prompt);
  const completionPrice = parseFloat(model.pricing.completion);

  if (isNaN(promptPrice) || isNaN(completionPrice)) {
    return 0;
  }

  const inputCost = usage.prompt_tokens * promptPrice;
  const outputCost = usage.completion_tokens * completionPrice;

  return inputCost + outputCost;
}
```

**Step 4: Commit registry**

```bash
git add src/models/registry.ts
git commit -m "feat: add ModelRegistry with OpenRouter API integration"
```

---

## Task 3: Create Config Manager

**Files:**
- Create: `src/models/config.ts`

**Step 1: Create config manager class**

Create `src/models/config.ts`:

```typescript
import { ModelConfig } from '../types/index.js';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

const DEFAULT_CONFIG: ModelConfig = {
  currentModel: 'anthropic/claude-3.5-sonnet',
  favoriteModels: [
    'google/gemini-flash-1.5',
    'meta-llama/llama-3.1-8b-instruct',
    'anthropic/claude-3-haiku',
    'openai/gpt-4o-mini',
    'anthropic/claude-3.5-sonnet',
    'openai/gpt-4o',
  ],
};

export class ConfigManager {
  private config: ModelConfig;

  constructor() {
    this.config = this.load();
  }

  load(): ModelConfig {
    try {
      if (!fs.existsSync(CONFIG_PATH)) {
        this.save(DEFAULT_CONFIG);
        return DEFAULT_CONFIG;
      }

      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(data);

      // Validate structure
      if (!parsed.currentModel || !Array.isArray(parsed.favoriteModels)) {
        throw new Error('Invalid config structure');
      }

      return parsed;
    } catch (error) {
      console.error('Failed to load config, using default:', error);

      // Backup corrupted config
      if (fs.existsSync(CONFIG_PATH)) {
        fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.backup`);
      }

      this.save(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
  }

  save(config: ModelConfig): void {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
      this.config = config;
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  getConfig(): ModelConfig {
    return this.config;
  }

  setCurrentModel(modelId: string): void {
    this.config.currentModel = modelId;
    this.save(this.config);
  }

  addFavoriteModel(modelId: string): boolean {
    if (this.config.favoriteModels.includes(modelId)) {
      return false; // Already exists
    }

    this.config.favoriteModels.push(modelId);
    this.save(this.config);
    return true;
  }

  removeFavoriteModel(index: number): boolean {
    if (index < 0 || index >= this.config.favoriteModels.length) {
      return false; // Invalid index
    }

    if (this.config.favoriteModels.length <= 1) {
      return false; // Can't remove last model
    }

    this.config.favoriteModels.splice(index, 1);

    // If current model was removed, switch to first available
    if (!this.config.favoriteModels.includes(this.config.currentModel)) {
      this.config.currentModel = this.config.favoriteModels[0];
    }

    this.save(this.config);
    return true;
  }
}
```

**Step 2: Commit config manager**

```bash
git add src/models/config.ts
git commit -m "feat: add ConfigManager for model configuration persistence"
```

---

## Task 4: Update index.tsx to Initialize Services

**Files:**
- Modify: `src/index.tsx`

**Step 1: Import new services**

Add imports at top of `src/index.tsx` after existing imports:

```typescript
import { ModelRegistry } from './models/registry.js';
import { ConfigManager } from './models/config.js';
```

**Step 2: Initialize services and pass to Chat**

Replace the code after environment variable checks in `src/index.tsx`:

```typescript
// Initialize model services
console.log('Loading models from OpenRouter...');
const modelRegistry = new ModelRegistry();
await modelRegistry.initialize();

const configManager = new ConfigManager();
const config = configManager.getConfig();

console.log(`Current model: ${config.currentModel}`);
console.log('Starting chat...\n');

// Запуск приложения
render(<Chat modelRegistry={modelRegistry} configManager={configManager} />);
```

**Step 3: Commit initialization**

```bash
git add src/index.tsx
git commit -m "feat: initialize ModelRegistry and ConfigManager on startup"
```

---

## Task 5: Update Chat Component Props and State

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add props interface**

Add after imports in `src/components/Chat.tsx`:

```typescript
import { ModelRegistry } from '../models/registry.js';
import { ConfigManager } from '../models/config.js';

interface ChatProps {
  modelRegistry: ModelRegistry;
  configManager: ConfigManager;
}
```

**Step 2: Update component signature**

Replace `export const Chat: React.FC = () => {` with:

```typescript
export const Chat: React.FC<ChatProps> = ({ modelRegistry, configManager }) => {
```

**Step 3: Add currentModel state**

Add after existing useState declarations:

```typescript
const [currentModel, setCurrentModel] = useState(configManager.getConfig().currentModel);
```

**Step 4: Remove old calculateCost function**

Delete the existing `calculateCost` function (lines 13-19).

**Step 5: Commit chat updates**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add modelRegistry and configManager props to Chat"
```

---

## Task 6: Update sendMessage to Use Current Model

**Files:**
- Modify: `src/api/openrouter.ts`

**Step 1: Update sendMessage signature**

Change function signature in `src/api/openrouter.ts` from:

```typescript
export async function sendMessage(messages: Message[], systemPrompt?: string, temperature?: number): Promise<ApiResponse>
```

to:

```typescript
export async function sendMessage(
  messages: Message[],
  modelId: string,
  systemPrompt?: string,
  temperature?: number
): Promise<ApiResponse>
```

**Step 2: Use modelId parameter instead of env var**

Replace these lines in `src/api/openrouter.ts`:

```typescript
const model = process.env.OPENROUTER_MODEL;

if (!model) {
  throw new Error('OPENROUTER_MODEL не найден в переменных окружения');
}
```

with:

```typescript
if (!modelId) {
  throw new Error('Model ID is required');
}
```

And update the requestBody to use `modelId`:

```typescript
const requestBody: OpenRouterRequest = {
  model: modelId,  // Changed from 'model' variable
  messages: allMessages,
  ...(temperature !== undefined && { temperature }),
};
```

**Step 3: Update Chat.tsx sendMessage call**

In `src/components/Chat.tsx`, find the line with `sendMessage(conversation.getHistory(), systemPrompt, temperature)` and replace with:

```typescript
const apiResponse = await sendMessage(
  conversation.getHistory(),
  currentModel,
  systemPrompt,
  temperature
);
```

**Step 4: Update cost calculation to use registry**

In `src/components/Chat.tsx`, replace the code that sets `lastResponseMetrics`:

```typescript
// Сохраняем метрики последнего ответа
setLastResponseMetrics({
  responseTime: apiResponse.responseTime,
  usage: apiResponse.usage,
});

// Обновляем статистику сессии (если есть usage)
if (apiResponse.usage) {
  const usage = apiResponse.usage;
  const cost = modelRegistry.calculateCost(currentModel, usage);

  setSessionStats(prev => ({
    totalTokens: prev.totalTokens + usage.total_tokens,
    totalPromptTokens: prev.totalPromptTokens + usage.prompt_tokens,
    totalCompletionTokens: prev.totalCompletionTokens + usage.completion_tokens,
    totalCost: prev.totalCost + cost,
    requestCount: prev.requestCount + 1,
  }));
}
```

**Step 5: Update metrics display to use registry**

In `src/components/Chat.tsx`, find the metrics display section and replace:

```typescript
{lastResponseMetrics.usage
  ? `$${calculateCost(lastResponseMetrics.usage).toFixed(6)}`
  : 'N/A'
}
```

with:

```typescript
{lastResponseMetrics.usage
  ? `$${modelRegistry.calculateCost(currentModel, lastResponseMetrics.usage).toFixed(6)}`
  : 'N/A'
}
```

**Step 6: Update UI to show current model**

Replace the line showing the model in UI:

```typescript
Модель: {process.env.OPENROUTER_MODEL || 'не указана'} | Temperature: {temperature}
```

with:

```typescript
Модель: {currentModel} | Temperature: {temperature}
```

**Step 7: Commit API and Chat changes**

```bash
git add src/api/openrouter.ts src/components/Chat.tsx
git commit -m "feat: use dynamic model from config instead of env var"
```

---

## Task 7: Add Model Commands Handler

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add model list command**

Add new handler before `return false;` in `handleCommand()` function:

```typescript
// Model commands
if (trimmed === '/model') {
  const config = configManager.getConfig();
  const favorites = config.favoriteModels;

  let output = 'Доступные модели:\n';
  favorites.forEach((modelId, index) => {
    const model = modelRegistry.getModel(modelId);
    const name = model ? model.name : modelId;
    const current = modelId === currentModel ? ' ← текущая' : '';
    output += `${index + 1}. ${name} (${modelId})${current}\n`;
  });

  output += '\nКоманды:\n';
  output += '/model <номер> - переключиться\n';
  output += '/model add <model-id> - добавить модель\n';
  output += '/model remove <номер> - удалить модель';

  setNotification(output);
  return true;
}
```

**Step 2: Add model switch command**

Add after the previous handler:

```typescript
if (trimmed.startsWith('/model ') && !trimmed.startsWith('/model add') && !trimmed.startsWith('/model remove')) {
  const arg = trimmed.slice('/model '.length).trim();
  const num = parseInt(arg, 10);

  if (isNaN(num)) {
    setNotification('Используй номер модели, например: /model 3');
    return true;
  }

  const config = configManager.getConfig();
  const favorites = config.favoriteModels;

  if (num < 1 || num > favorites.length) {
    setNotification(`Номер должен быть от 1 до ${favorites.length}`);
    return true;
  }

  const modelId = favorites[num - 1];
  const model = modelRegistry.getModel(modelId);

  if (!model) {
    setNotification(`Модель ${modelId} не найдена в OpenRouter`);
    return true;
  }

  configManager.setCurrentModel(modelId);
  setCurrentModel(modelId);
  setNotification(`Модель переключена на: ${model.name} (${modelId})`);
  return true;
}
```

**Step 3: Add model add command**

Add after the previous handler:

```typescript
if (trimmed.startsWith('/model add ')) {
  const modelId = trimmed.slice('/model add '.length).trim();

  if (!modelId) {
    setNotification('Укажите ID модели, например: /model add anthropic/claude-3-opus');
    return true;
  }

  const model = modelRegistry.getModel(modelId);

  if (!model) {
    setNotification(`Модель ${modelId} не найдена в OpenRouter`);
    return true;
  }

  const added = configManager.addFavoriteModel(modelId);

  if (!added) {
    setNotification(`Модель ${model.name} уже в списке`);
    return true;
  }

  setNotification(`Модель ${model.name} (${modelId}) добавлена в список`);
  return true;
}
```

**Step 4: Add model remove command**

Add after the previous handler:

```typescript
if (trimmed.startsWith('/model remove ')) {
  const arg = trimmed.slice('/model remove '.length).trim();
  const num = parseInt(arg, 10);

  if (isNaN(num)) {
    setNotification('Используй номер модели, например: /model remove 2');
    return true;
  }

  const config = configManager.getConfig();
  const favorites = config.favoriteModels;

  if (num < 1 || num > favorites.length) {
    setNotification(`Номер должен быть от 1 до ${favorites.length}`);
    return true;
  }

  const modelId = favorites[num - 1];
  const model = modelRegistry.getModel(modelId);
  const modelName = model ? model.name : modelId;

  const removed = configManager.removeFavoriteModel(num - 1);

  if (!removed) {
    setNotification('Не могу удалить последнюю модель из списка');
    return true;
  }

  setNotification(`Модель ${modelName} удалена из списка`);
  return true;
}
```

**Step 5: Add /model help to UI**

In the UI section with command hints, add after the temperature hint:

```typescript
<Text dimColor>
  <Text color="yellow">/model</Text> - управление моделями | <Text color="yellow">/model add/remove</Text>
</Text>
```

**Step 6: Commit model commands**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add /model commands for model switching"
```

---

## Task 8: Update .gitignore

**Files:**
- Modify: `.gitignore`

**Step 1: Add config.json to gitignore**

Add to `.gitignore`:

```
config.json
config.json.backup
```

**Step 2: Commit gitignore**

```bash
git add .gitignore
git commit -m "chore: add config.json to gitignore"
```

---

## Task 9: Update README

**Files:**
- Modify: `README.md`

**Step 1: Update features section**

Replace the "Возможности" section in `README.md`:

```markdown
## Возможности

- Интерактивная REPL сессия
- Сохранение контекста диалога
- Переключение между моделями через команду /model
- Динамическая загрузка цен из OpenRouter API
- Управление избранными моделями
- Метрики API запросов (время ответа, токены, стоимость)
- Накопительная статистика сессии
- Цветной вывод в терминале
```

**Step 2: Update installation section**

Update step 3 in "Установка":

```markdown
3. Укажите ваш OpenRouter API ключ в `.env`:
```
OPENROUTER_API_KEY=your_api_key_here
```

Примечание: модель теперь выбирается через команду `/model` в приложении.
```

**Step 3: Add model commands section**

Add new section after "Использование":

```markdown
## Управление моделями

При первом запуске создается `config.json` с 6 предустановленными моделями:

**Слабые модели:**
- Google Gemini Flash 1.5
- Meta Llama 3.1 8B

**Средние модели:**
- Anthropic Claude 3 Haiku
- OpenAI GPT-4o Mini

**Сильные модели:**
- Anthropic Claude 3.5 Sonnet (по умолчанию)
- OpenAI GPT-4o

### Команды

- `/model` - показать список доступных моделей
- `/model <номер>` - переключиться на модель по номеру
- `/model add <model-id>` - добавить модель в избранное
- `/model remove <номер>` - удалить модель из избранного

### Примеры

```bash
# Показать список моделей
/model

# Переключиться на модель #3
/model 3

# Добавить новую модель
/model add anthropic/claude-3-opus

# Удалить модель #2 из списка
/model remove 2
```
```

**Step 4: Commit README**

```bash
git add README.md
git commit -m "docs: update README with model switching feature"
```

---

## Task 10: Remove OPENROUTER_MODEL from index.tsx validation

**Files:**
- Modify: `src/index.tsx`

**Step 1: Remove model validation**

Delete these lines from `src/index.tsx`:

```typescript
if (!process.env.OPENROUTER_MODEL) {
  console.error('Ошибка: OPENROUTER_MODEL не найден в .env файле');
  console.error('Создайте .env файл на основе .env.example и укажите модель');
  process.exit(1);
}
```

**Step 2: Update .env.example**

Modify `.env.example`:

```
OPENROUTER_API_KEY=your_api_key_here
```

Remove the OPENROUTER_MODEL line.

**Step 3: Commit cleanup**

```bash
git add src/index.tsx .env.example
git commit -m "refactor: remove OPENROUTER_MODEL env requirement"
```

---

## Task 11: Manual Testing

**Step 1: Build the project**

```bash
npm run build
```

Expected: Build succeeds without errors

**Step 2: Start the application**

```bash
npm start
```

Expected:
- Console shows "Loading models from OpenRouter..."
- Console shows "Current model: anthropic/claude-3.5-sonnet"
- Console shows "Starting chat..."
- UI displays with model name in header

**Step 3: Test /model command**

Type: `/model`

Expected: Shows list of 6 default models with numbers and current model marked

**Step 4: Test model switching**

Type: `/model 4`

Expected:
- Notification shows model switched
- Header updates to show new model name
- Next message uses the new model

**Step 5: Test sending message with different models**

1. Switch to model 1 (cheapest): `/model 1`
2. Send: "Hello, respond in one sentence"
3. Note the cost displayed
4. Switch to model 6 (most expensive): `/model 6`
5. Send: "Hello, respond in one sentence"
6. Compare costs - model 6 should be more expensive

Expected: Different models show different costs per token

**Step 6: Test adding model**

Type: `/model add deepseek/deepseek-chat`

Expected: Model added to list, `/model` now shows 7 models

**Step 7: Test removing model**

Type: `/model remove 7`

Expected: Model removed, `/model` shows 6 models again

**Step 8: Test persistence**

1. Switch to model 3: `/model 3`
2. Exit app (Ctrl+C)
3. Restart: `npm start`

Expected: App starts with model 3 as current model

**Step 9: Test config.json**

Check file exists:
```bash
cat config.json
```

Expected: JSON file with currentModel and favoriteModels array

**Step 10: Test error handling - invalid model number**

Type: `/model 99`

Expected: Error message "Номер должен быть от 1 до N"

**Step 11: Test error handling - can't remove last model**

1. Remove all but one model
2. Try to remove the last one

Expected: Error message about needing at least one model

---

## Completion

All tasks complete! The model switching feature is fully implemented with:

✅ Dynamic model loading from OpenRouter API
✅ Config persistence between sessions
✅ Model switching via `/model` commands
✅ Accurate cost calculation per model
✅ Add/remove custom models
✅ Comprehensive error handling
✅ Updated documentation

The user can now compare different models (weak, medium, strong) by executing the same query and observing tokens, cost, and response time metrics.
