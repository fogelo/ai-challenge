# Ollama Params Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `maxTokens` and `numCtx` parameters for the Ollama provider, persisted in `config.json`, with `/ollama:maxTokens` and `/ollama:numCtx` commands in the CLI agent.

**Architecture:** New `OllamaParams` type flows from `config.json` → `ConfigManager` → `src/api/index.ts` router → `ollama.ts` API call. Chat.tsx gets two new commands and a provider-aware status bar. The pattern mirrors how `ollamaModel` / `ollamaBaseUrl` are already handled — config storage in `ConfigManager`, retrieval in `index.ts`, no extra state in Chat.tsx.

**Tech Stack:** TypeScript, Vitest, Ink (React for CLI), Node.js fs

---

## File Map

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `OllamaParams` interface; add field to `ModelConfig` |
| `src/models/config.ts` | Add defaults, `load()` migration, `getOllamaParams()`, `setOllamaParams()` |
| `src/models/config.test.ts` | Add tests for new methods |
| `src/api/ollama.ts` | Add `max_tokens` and `options.num_ctx` to request |
| `src/api/ollama.test.ts` | Add tests for new params in request body |
| `src/api/index.ts` | Widen `Pick` constraint, read params, pass to Ollama |
| `src/api/index.test.ts` | Update existing Ollama assertion + add params test |
| `src/components/Chat.tsx` | Two new commands, updated status bar, updated `/help` |

---

## Task 1: Add `OllamaParams` type and update `ModelConfig`

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add `OllamaParams` interface after the `ModelConfig` interface**

In `src/types/index.ts`, after line 178 (end of `ModelConfig`), add:

```ts
export interface OllamaParams {
  /** max_tokens in Ollama /v1/chat/completions (OpenAI-compatible field) */
  maxTokens?: number;
  /** options.num_ctx — context window size for the model */
  numCtx?: number;
}
```

- [ ] **Step 2: Add `ollamaParams` field to `ModelConfig`**

In `src/types/index.ts`, inside `ModelConfig` (after `ollamaModel: string;` on line 177):

```ts
  ollamaParams?: OllamaParams;
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add OllamaParams interface and field to ModelConfig"
```

---

## Task 2: Update `ConfigManager` — defaults, migration, new methods

**Files:**
- Modify: `src/models/config.ts`
- Modify: `src/models/config.test.ts`

- [ ] **Step 1: Write failing tests first**

Add to `src/models/config.test.ts` (after existing `describe` block):

```ts
describe('ConfigManager ollamaParams', () => {
  let backup: string | null = null;

  beforeEach(() => {
    if (fs.existsSync(TEST_CONFIG_PATH)) {
      backup = fs.readFileSync(TEST_CONFIG_PATH, 'utf-8');
    }
  });

  afterEach(() => {
    if (backup !== null) {
      fs.writeFileSync(TEST_CONFIG_PATH, backup);
    } else if (fs.existsSync(TEST_CONFIG_PATH)) {
      fs.unlinkSync(TEST_CONFIG_PATH);
    }
  });

  it('getOllamaParams returns defaults when field missing from config', () => {
    const minimal = {
      currentModel: 'anthropic/claude-3.5-sonnet',
      favoriteModels: ['anthropic/claude-3.5-sonnet'],
      summarization: { threshold: 0.7, keepRecentMessages: 10 },
      strategy: { default: 'sliding', slidingWindow: { size: 10 }, stickyFacts: { windowSize: 10 }, branching: {} },
    };
    fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(minimal));

    const cm = new ConfigManager();
    const params = cm.getOllamaParams();

    expect(params.maxTokens).toBe(2048);
    expect(params.numCtx).toBe(4096);
  });

  it('setOllamaParams persists and can be read back', () => {
    const cm = new ConfigManager();
    cm.setOllamaParams({ maxTokens: 1024, numCtx: 8192 });

    const cm2 = new ConfigManager();
    const params = cm2.getOllamaParams();

    expect(params.maxTokens).toBe(1024);
    expect(params.numCtx).toBe(8192);
  });

  it('setOllamaParams partial update preserves other fields', () => {
    const cm = new ConfigManager();
    cm.setOllamaParams({ maxTokens: 512, numCtx: 4096 });
    cm.setOllamaParams({ numCtx: 16384 });

    const params = cm.getOllamaParams();
    expect(params.maxTokens).toBe(512);
    expect(params.numCtx).toBe(16384);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd day29 && npx vitest run src/models/config.test.ts
```

Expected: FAIL — `cm.getOllamaParams is not a function`

- [ ] **Step 3: Add defaults to `DEFAULT_CONFIG` in `src/models/config.ts`**

Inside `DEFAULT_CONFIG` object, after `ollamaModel: 'llama3.2'`:

```ts
  ollamaParams: {
    maxTokens: 2048,
    numCtx: 4096,
  },
```

- [ ] **Step 4: Add migration block in `load()` in `src/models/config.ts`**

Inside `load()`, after the existing `if (!parsed.ollamaModel)` block (around line 84):

```ts
      if (!parsed.ollamaParams) {
        parsed.ollamaParams = DEFAULT_CONFIG.ollamaParams;
      }
```

- [ ] **Step 5: Add `getOllamaParams()` and `setOllamaParams()` methods to `ConfigManager`**

After the `setProvider()` method (around line 143):

```ts
  getOllamaParams(): OllamaParams {
    return this.config.ollamaParams ?? DEFAULT_CONFIG.ollamaParams!;
  }

  setOllamaParams(params: Partial<OllamaParams>): void {
    this.config.ollamaParams = {
      ...this.getOllamaParams(),
      ...params,
    };
    this.save(this.config);
  }
```

Also add the import for `OllamaParams` to the import line at the top of `config.ts`:

```ts
import { ModelConfig, SummarizationConfig, StrategyConfig, OllamaParams } from '../types/index.js';
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd day29 && npx vitest run src/models/config.test.ts
```

Expected: PASS (all tests including existing ones)

- [ ] **Step 7: Commit**

```bash
git add src/models/config.ts src/models/config.test.ts
git commit -m "feat(config): add OllamaParams defaults, migration, and get/set methods"
```

---

## Task 3: Update `ollama.ts` — add params to request

**Files:**
- Modify: `src/api/ollama.ts`
- Modify: `src/api/ollama.test.ts`

- [ ] **Step 1: Write failing tests**

The existing `ollama.test.ts` uses `global.fetch = mockFetch` (line 4-5) and `const { sendMessage } = await import('./ollama.js')` inside each `it()`. Follow the same pattern. Add two new `it()` blocks inside the existing `describe('ollama sendMessage', ...)` block:

```ts
  it('includes max_tokens in request when maxTokens provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const { sendMessage } = await import('./ollama.js');
    await sendMessage(
      [{ role: 'user', content: 'hello' }],
      'mistral',
      'http://localhost:11434',
      undefined,
      undefined,
      undefined,
      512   // maxTokens
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(512);
  });

  it('includes options.num_ctx in request when numCtx provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const { sendMessage } = await import('./ollama.js');
    await sendMessage(
      [{ role: 'user', content: 'hello' }],
      'mistral',
      'http://localhost:11434',
      undefined,
      undefined,
      undefined,
      undefined,
      8192  // numCtx
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options?.num_ctx).toBe(8192);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd day29 && npx vitest run src/api/ollama.test.ts
```

Expected: FAIL

- [ ] **Step 3: Update `OllamaRequest` interface in `src/api/ollama.ts`**

Replace the existing `OllamaRequest` interface:

```ts
interface OllamaRequest {
  model: string;
  messages: unknown[];
  temperature?: number;
  max_tokens?: number;
  options?: { num_ctx?: number };
  tools?: unknown[];
  tool_choice?: 'auto';
}
```

- [ ] **Step 4: Update `sendMessage` signature in `src/api/ollama.ts`**

Change the function signature to add two trailing optional params:

```ts
export async function sendMessage(
  messages: Message[],
  modelId: string,
  baseUrl: string,
  systemPrompt?: string,
  temperature?: number,
  tools?: MCPTool[],
  maxTokens?: number,
  numCtx?: number
): Promise<ApiResponse>
```

- [ ] **Step 5: Add new params to `requestBody` construction in `src/api/ollama.ts`**

In the `requestBody` object (after the existing `temperature` spread):

```ts
  ...(maxTokens !== undefined && { max_tokens: maxTokens }),
  ...(numCtx !== undefined && { options: { num_ctx: numCtx } }),
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd day29 && npx vitest run src/api/ollama.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/api/ollama.ts src/api/ollama.test.ts
git commit -m "feat(ollama): add maxTokens and numCtx params to sendMessage"
```

---

## Task 4: Update `index.ts` router — pass params to Ollama

**Files:**
- Modify: `src/api/index.ts`
- Modify: `src/api/index.test.ts`

- [ ] **Step 1: Write failing tests**

In `src/api/index.test.ts`:

**a)** Update the existing `routes to Ollama when provider is ollama` test (lines 36-49) — add `getOllamaParams` to its `fakeConfig`:

```ts
  it('routes to Ollama when provider is ollama', async () => {
    const fakeConfig = {
      getProviderConfig: () => ({
        provider: 'ollama' as const,
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'gemma3',
      }),
      getOllamaParams: () => ({ maxTokens: undefined, numCtx: undefined }),
    };
    const send = getSendMessage(fakeConfig as any);
    const result = await send(fakeMessages, 'anthropic/claude-3.5-sonnet');
    expect(result.content).toBe('from ollama');
    expect(mockOllamaSend).toHaveBeenCalledOnce();
    expect(mockOpenRouterSend).not.toHaveBeenCalled();
  });
```

**b)** Update the existing `passes ollamaBaseUrl and ollamaModel to Ollama client` test (lines 51-69) and add a new test after it:

```ts
  it('passes ollamaBaseUrl and ollamaModel to Ollama client', async () => {
    const fakeConfig = {
      getProviderConfig: () => ({
        provider: 'ollama' as const,
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'llama3.2',
      }),
      getOllamaParams: () => ({ maxTokens: undefined, numCtx: undefined }),
    };
    const send = getSendMessage(fakeConfig as any);
    await send(fakeMessages, 'any-model', 'system prompt');
    expect(mockOllamaSend).toHaveBeenCalledWith(
      fakeMessages,
      'llama3.2',
      'http://localhost:11434',
      'system prompt',
      undefined,
      undefined,
      undefined,
      undefined
    );
  });

  // This it() goes INSIDE the same describe('getSendMessage', ...) block as the tests above
  it('passes maxTokens and numCtx from config to Ollama client', async () => {
    const fakeConfig = {
      getProviderConfig: () => ({
        provider: 'ollama' as const,
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'mistral',
      }),
      getOllamaParams: () => ({ maxTokens: 1024, numCtx: 8192 }),
    };
    const send = getSendMessage(fakeConfig as any);
    await send(fakeMessages, 'any-model');
    expect(mockOllamaSend).toHaveBeenCalledWith(
      fakeMessages,
      'mistral',
      'http://localhost:11434',
      undefined,
      undefined,
      undefined,
      1024,
      8192
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd day29 && npx vitest run src/api/index.test.ts
```

Expected: FAIL — `getOllamaParams is not a function` or wrong call args

- [ ] **Step 3: Update `getSendMessage` in `src/api/index.ts`**

Replace the entire file content:

```ts
import { sendMessage as sendMessageOpenRouter } from './openrouter.js';
import { sendMessage as sendMessageOllama } from './ollama.js';
import type { ConfigManager } from '../models/config.js';
import type { Message, ApiResponse } from '../types/index.js';
import type { MCPTool } from '../mcp/index.js';

export function getSendMessage(configManager: Pick<ConfigManager, 'getProviderConfig' | 'getOllamaParams'>) {
  return async (
    messages: Message[],
    modelId: string,
    systemPrompt?: string,
    temperature?: number,
    tools?: MCPTool[]
  ): Promise<ApiResponse> => {
    const { provider, ollamaBaseUrl, ollamaModel } = configManager.getProviderConfig();

    if (provider === 'ollama') {
      const { maxTokens, numCtx } = configManager.getOllamaParams();
      return sendMessageOllama(messages, ollamaModel, ollamaBaseUrl, systemPrompt, temperature, tools, maxTokens, numCtx);
    }

    return sendMessageOpenRouter(messages, modelId, systemPrompt, temperature, tools);
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd day29 && npx vitest run src/api/index.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/index.ts src/api/index.test.ts
git commit -m "feat(api): pass ollamaParams through getSendMessage router"
```

---

## Task 5: Add commands and update UI in `Chat.tsx`

**Files:**
- Modify: `src/components/Chat.tsx`

No unit tests for Chat.tsx (Ink component — tested manually).

- [ ] **Step 1: Add `/ollama:maxTokens` command**

In `Chat.tsx`, find the `/temperature` command block (around line 574). Add the following **after** the `/temperature` block:

```tsx
    if (trimmed.startsWith('/ollama:maxTokens ')) {
      const value = trimmed.slice('/ollama:maxTokens '.length).trim();
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 64 || num > 32768) {
        setNotification('maxTokens должен быть целым числом от 64 до 32768');
        return true;
      }
      configManager.setOllamaParams({ maxTokens: num });
      setNotification(`✅ Ollama maxTokens установлен на ${num}`);
      return true;
    }

    if (trimmed === '/ollama:maxTokens') {
      const { maxTokens } = configManager.getOllamaParams();
      setNotification(`Текущий Ollama maxTokens: ${maxTokens ?? 'не задан'}`);
      return true;
    }
```

- [ ] **Step 2: Add `/ollama:numCtx` command**

Directly after the `/ollama:maxTokens` block:

```tsx
    if (trimmed.startsWith('/ollama:numCtx ')) {
      const value = trimmed.slice('/ollama:numCtx '.length).trim();
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 512 || num > 131072) {
        setNotification('numCtx должен быть целым числом от 512 до 131072');
        return true;
      }
      if (num > 32768) {
        setNotification(`⚠️ numCtx ${num} может не поддерживаться моделью. Сохраняю...`);
      }
      configManager.setOllamaParams({ numCtx: num });
      if (num <= 32768) {
        setNotification(`✅ Ollama numCtx установлен на ${num}`);
      }
      return true;
    }

    if (trimmed === '/ollama:numCtx') {
      const { numCtx } = configManager.getOllamaParams();
      setNotification(`Текущий Ollama numCtx: ${numCtx ?? 'не задан'}`);
      return true;
    }
```

- [ ] **Step 3: Update status bar (line ~2503)**

Replace:
```tsx
        <Text dimColor>
          Модель: {currentModel} | Temperature: {temperature}
        </Text>
```

With:
```tsx
        <Text dimColor>
          {configManager.getProviderConfig().provider === 'ollama'
            ? (() => {
                const { maxTokens, numCtx } = configManager.getOllamaParams();
                return `Модель: ${currentModel} | Temperature: ${temperature} | MaxTok: ${maxTokens ?? '-'} | Ctx: ${numCtx ?? '-'}`;
              })()
            : `Модель: ${currentModel} | Temperature: ${temperature}`}
        </Text>
```

- [ ] **Step 4: Update `/help` text**

Find the `/help` handler (around line 1773). In the `🌐 Провайдер:` section, after the `/provider ollama <model>` line, add:

```
  /ollama:maxTokens [N]     - установить/показать max tokens (64–32768)
  /ollama:numCtx [N]        - установить/показать context window (512–131072)
```

- [ ] **Step 5: Update the status bar hint lines below the status bar (~line 2510)**

Find the line:
```tsx
          <Text color="yellow">/temperature [0-2]</Text> - установить temperature
```

Add a new `<Text dimColor>` line after it (or on same line after `|`):
```tsx
        <Text dimColor>
          <Text color="yellow">/ollama:maxTokens [N]</Text> - max tokens | <Text color="yellow">/ollama:numCtx [N]</Text> - context window (только Ollama)
        </Text>
```

- [ ] **Step 6: Build to verify no TypeScript errors**

```bash
cd day29 && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): add /ollama:maxTokens and /ollama:numCtx commands with status bar"
```

---

## Task 6: Update `config.json` defaults and run full test suite

**Files:**
- Modify: `config.json`

- [ ] **Step 1: Add `ollamaParams` to `config.json`**

Open `config.json`. Add after `"ollamaModel"`:

```json
"ollamaParams": {
  "maxTokens": 2048,
  "numCtx": 4096
}
```

- [ ] **Step 2: Run full test suite**

```bash
cd day29 && npx vitest run
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add config.json
git commit -m "chore(config): add ollamaParams defaults to config.json"
```

---

## Task 7: Manual testing and demo prep

After all tasks are complete:

### Testing checklist

- [ ] Start agent: `npm start`
- [ ] Run `/provider ollama mistral-32k:latest` — verify status bar shows `MaxTok: 2048 | Ctx: 4096`
- [ ] Run `/ollama:maxTokens` — should show `2048`
- [ ] Run `/ollama:maxTokens 512` — should confirm, status bar updates
- [ ] Run `/ollama:numCtx 8192` — should confirm, status bar updates
- [ ] Run `/ollama:maxTokens 50` — should show validation error (< 64)
- [ ] Run `/ollama:numCtx 100` — should show validation error (< 512)
- [ ] Run `/ollama:numCtx 50000` — should show warning about unsupported range
- [ ] Stop and restart agent: `npm start` — verify params restored from `config.json`
- [ ] Run `/provider openrouter` — verify status bar shows **without** MaxTok/Ctx
- [ ] Run `/help` — verify new commands appear in the Провайдер section
- [ ] Send a message with Ollama provider — verify response arrives and params are used

### Demo video plan (~5 minutes)

| Время | Действие |
|-------|----------|
| 0:00–0:30 | Запуск агента, `/provider ollama mistral-32k:latest`, смотрим статус-строку с дефолтными параметрами |
| 0:30–1:30 | **До оптимизации**: задаём вопрос по коду (напр. "напиши функцию TypeScript для парсинга CSV"). Отмечаем время ответа и длину |
| 1:30–2:30 | Показываем `/ollama:numCtx` (4096) → `/ollama:numCtx 8192`; `/ollama:maxTokens` (2048) → `/ollama:maxTokens 512`. Объясняем вслух что делает каждый параметр |
| 2:30–3:30 | **После оптимизации**: тот же вопрос снова. Сравниваем: ответ стал короче (ограничен 512 токенами), контекст расширен |
| 3:30–4:00 | `/temperature 0.1` — детерминированный режим для кода. Повторяем вопрос — ответ стабилен |
| 4:00–4:30 | Ctrl+C, открываем `config.json` — параметры сохранены. Перезапускаем `npm start` — всё восстановилось |
| 4:30–5:00 | Переключаемся `/provider openrouter` — статус-строка без MaxTok/Ctx. Итог: что оптимизировали и зачем |
