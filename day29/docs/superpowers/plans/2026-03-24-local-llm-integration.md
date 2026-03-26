# Local LLM Integration (Ollama) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ollama as a local LLM provider alongside OpenRouter, switchable via `/provider` commands in the CLI, persisted in `config.json`.

**Architecture:** New `src/api/ollama.ts` client with the same `sendMessage` signature as OpenRouter. A provider-aware `src/api/index.ts` wrapper routes calls based on `configManager.getProviderConfig()`. `src/rag/querier.ts` uses a module-level `initQuerier(configManager)` factory so RAG also uses the active provider.

**Tech Stack:** TypeScript, Ink (React CLI), Vitest, native fetch, Ollama OpenAI-compatible API (`/v1/chat/completions`)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/types/index.ts` | Modify | Add `provider`, `ollamaBaseUrl`, `ollamaModel` to `ModelConfig` |
| `src/models/config.ts` | Modify | Add defaults + `getProviderConfig()` + `setProvider()` |
| `src/api/ollama.ts` | **Create** | Ollama API client |
| `src/api/index.ts` | **Create** | Provider-aware `getSendMessage` wrapper |
| `src/rag/querier.ts` | Modify | Add `initQuerier()`, replace `sendMessage` with `_sendMessage` |
| `src/components/Chat.tsx` | Modify | Switch to `getSendMessage`, add `/provider` command, suppress tools for Ollama |
| `src/index.tsx` | Modify | Make API key check conditional on provider; call `initQuerier` |

---

## Task 1: Add provider fields to ModelConfig type

**Files:**
- Modify: `src/types/index.ts:170-175`

- [ ] **Step 1: Add fields to interface**

In `src/types/index.ts`, replace:

```ts
export interface ModelConfig {
  currentModel: string;
  favoriteModels: string[];
  summarization: SummarizationConfig;
  strategy: StrategyConfig;
}
```

With:

```ts
export interface ModelConfig {
  currentModel: string;
  favoriteModels: string[];
  summarization: SummarizationConfig;
  strategy: StrategyConfig;
  provider: 'openrouter' | 'ollama';
  ollamaBaseUrl: string;
  ollamaModel: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd day27 && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors only about missing defaults in `config.ts` (not type errors in other files yet).

- [ ] **Step 3: Commit**

```bash
cd day27 && git add src/types/index.ts && git commit -m "feat(day27): add provider fields to ModelConfig type"
```

---

## Task 2: Update ConfigManager with provider support

**Files:**
- Modify: `src/models/config.ts`
- Test: `src/models/config.test.ts` (create)

- [ ] **Step 1: Write failing tests**

Create `src/models/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from './config.js';
import fs from 'fs';
import path from 'path';

const TEST_CONFIG_PATH = path.join(process.cwd(), 'config.json');

describe('ConfigManager provider support', () => {
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

  it('getProviderConfig returns defaults when fields missing', () => {
    const minimal = {
      currentModel: 'anthropic/claude-3.5-sonnet',
      favoriteModels: ['anthropic/claude-3.5-sonnet'],
      summarization: { threshold: 0.7, keepRecentMessages: 10 },
      strategy: { default: 'sliding', slidingWindow: { size: 10 }, stickyFacts: { windowSize: 10 }, branching: {} },
    };
    fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(minimal));

    const cm = new ConfigManager();
    const cfg = cm.getProviderConfig();

    expect(cfg.provider).toBe('openrouter');
    expect(cfg.ollamaBaseUrl).toBe('http://localhost:11434');
    expect(cfg.ollamaModel).toBe('llama3.2');
  });

  it('setProvider persists provider and ollamaModel', () => {
    const cm = new ConfigManager();
    cm.setProvider('ollama', 'gemma3');

    const cm2 = new ConfigManager();
    const cfg = cm2.getProviderConfig();

    expect(cfg.provider).toBe('ollama');
    expect(cfg.ollamaModel).toBe('gemma3');
  });

  it('setProvider to openrouter preserves ollamaModel', () => {
    const cm = new ConfigManager();
    cm.setProvider('ollama', 'llama3.2');
    cm.setProvider('openrouter');

    const cfg = cm.getProviderConfig();
    expect(cfg.provider).toBe('openrouter');
    expect(cfg.ollamaModel).toBe('llama3.2');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd day27 && npm test -- src/models/config.test.ts 2>&1 | tail -20
```

Expected: FAIL — `getProviderConfig is not a function`

- [ ] **Step 3: Update DEFAULT_CONFIG and load() in config.ts**

In `src/models/config.ts`, update `DEFAULT_CONFIG`:

```ts
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
  summarization: {
    threshold: 0.7,
    keepRecentMessages: 10,
  },
  strategy: {
    default: 'sliding',
    slidingWindow: { size: 10 },
    stickyFacts: { windowSize: 10 },
    branching: { maxCheckpoints: 20 },
  },
  provider: 'openrouter',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
};
```

In the `load()` method, after the `strategy` defaults block, add:

```ts
// Add provider defaults if missing
if (!parsed.provider) {
  parsed.provider = DEFAULT_CONFIG.provider;
}
if (!parsed.ollamaBaseUrl) {
  parsed.ollamaBaseUrl = DEFAULT_CONFIG.ollamaBaseUrl;
}
if (!parsed.ollamaModel) {
  parsed.ollamaModel = DEFAULT_CONFIG.ollamaModel;
}
```

- [ ] **Step 4: Add getProviderConfig() and setProvider() methods**

Add to `ConfigManager` class (after `getStrategyConfig()`):

```ts
getProviderConfig(): { provider: 'openrouter' | 'ollama'; ollamaBaseUrl: string; ollamaModel: string } {
  return {
    provider: this.config.provider ?? 'openrouter',
    ollamaBaseUrl: this.config.ollamaBaseUrl ?? 'http://localhost:11434',
    ollamaModel: this.config.ollamaModel ?? 'llama3.2',
  };
}

setProvider(provider: 'openrouter' | 'ollama', ollamaModel?: string): void {
  this.config.provider = provider;
  if (ollamaModel) {
    this.config.ollamaModel = ollamaModel;
  }
  this.save(this.config);
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd day27 && npm test -- src/models/config.test.ts 2>&1 | tail -20
```

Expected: PASS — 3 tests passing

- [ ] **Step 6: Commit**

```bash
cd day27 && git add src/models/config.ts src/models/config.test.ts && git commit -m "feat(day27): add provider config fields and ConfigManager methods"
```

---

## Task 3: Create Ollama API client

**Files:**
- Create: `src/api/ollama.ts`
- Test: `src/api/ollama.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/api/ollama.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ollama sendMessage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends request to correct Ollama endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello from Ollama', role: 'assistant' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const { sendMessage } = await import('./ollama.js');
    const result = await sendMessage(
      [{ role: 'user', content: 'Hello' }],
      'llama3.2',
      'http://localhost:11434',
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.content).toBe('Hello from Ollama');
  });

  it('includes system prompt when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok', role: 'assistant' }, finish_reason: 'stop' }],
      }),
    });

    const { sendMessage } = await import('./ollama.js');
    await sendMessage(
      [{ role: 'user', content: 'hi' }],
      'llama3.2',
      'http://localhost:11434',
      'You are helpful',
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful' });
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'model not found',
    });

    const { sendMessage } = await import('./ollama.js');
    await expect(
      sendMessage([{ role: 'user', content: 'hi' }], 'bad-model', 'http://localhost:11434')
    ).rejects.toThrow('404');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd day27 && npm test -- src/api/ollama.test.ts 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module './ollama.js'`

- [ ] **Step 3: Create src/api/ollama.ts**

```ts
import { Message, ApiResponse, ToolCall } from '../types/index.js';
import type { MCPTool } from '../mcp/index.js';

interface OllamaRequest {
  model: string;
  messages: unknown[];
  temperature?: number;
  tools?: unknown[];
  tool_choice?: 'auto';
}

interface OllamaResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function sendMessage(
  messages: Message[],
  modelId: string,
  baseUrl: string,
  systemPrompt?: string,
  temperature?: number,
  tools?: MCPTool[]
): Promise<ApiResponse> {
  const allMessages = (systemPrompt
    ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
    : messages
  ).map((m) => {
    const msg: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    return msg;
  });

  const ollamaTools = tools && tools.length > 0
    ? tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema && typeof tool.inputSchema === 'object' && 'type' in tool.inputSchema
            ? tool.inputSchema as Record<string, unknown>
            : { type: 'object', properties: {} },
        },
      }))
    : undefined;

  const requestBody: OllamaRequest = {
    model: modelId,
    messages: allMessages,
    ...(temperature !== undefined && { temperature }),
    ...(ollamaTools && { tools: ollamaTools, tool_choice: 'auto' }),
  };

  const startTime = performance.now();

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  const data: OllamaResponse = await response.json();
  const responseTime = (performance.now() - startTime) / 1000;

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Некорректный формат ответа от Ollama');
  }

  const choice = data.choices[0];
  const rawToolCalls = choice.message.tool_calls;
  const finishReason = choice.finish_reason;

  const toolCalls: ToolCall[] | undefined =
    (finishReason === 'tool_calls' || (rawToolCalls && rawToolCalls.length > 0))
      ? rawToolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: (() => {
            try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; }
            catch { return {}; }
          })(),
        }))
      : undefined;

  return {
    content: choice.message.content ?? '',
    usage: data.usage,
    responseTime,
    toolCalls,
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd day27 && npm test -- src/api/ollama.test.ts 2>&1 | tail -10
```

Expected: PASS — 3 tests passing

- [ ] **Step 5: Commit**

```bash
cd day27 && git add src/api/ollama.ts src/api/ollama.test.ts && git commit -m "feat(day27): add Ollama API client"
```

---

## Task 4: Create provider-aware sendMessage wrapper

**Files:**
- Create: `src/api/index.ts`
- Test: `src/api/index.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/api/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSendMessage } from './index.js';

const mockOpenRouterSend = vi.fn();
const mockOllamaSend = vi.fn();

vi.mock('./openrouter.js', () => ({ sendMessage: mockOpenRouterSend }));
vi.mock('./ollama.js', () => ({ sendMessage: mockOllamaSend }));

const fakeMessages = [{ role: 'user' as const, content: 'hi' }];

beforeEach(() => {
  mockOpenRouterSend.mockReset().mockResolvedValue({ content: 'from openrouter', responseTime: 0.1 });
  mockOllamaSend.mockReset().mockResolvedValue({ content: 'from ollama', responseTime: 0.1 });
});

describe('getSendMessage', () => {
  it('routes to OpenRouter when provider is openrouter', async () => {
    const fakeConfig = {
      getProviderConfig: () => ({
        provider: 'openrouter' as const,
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'llama3.2',
      }),
    };
    const send = getSendMessage(fakeConfig as any);
    const result = await send(fakeMessages, 'anthropic/claude-3.5-sonnet');
    expect(result.content).toBe('from openrouter');
    expect(mockOpenRouterSend).toHaveBeenCalledOnce();
    expect(mockOllamaSend).not.toHaveBeenCalled();
  });

  it('routes to Ollama when provider is ollama', async () => {
    const fakeConfig = {
      getProviderConfig: () => ({
        provider: 'ollama' as const,
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'gemma3',
      }),
    };
    const send = getSendMessage(fakeConfig as any);
    const result = await send(fakeMessages, 'anthropic/claude-3.5-sonnet');
    expect(result.content).toBe('from ollama');
    expect(mockOllamaSend).toHaveBeenCalledOnce();
    expect(mockOpenRouterSend).not.toHaveBeenCalled();
  });

  it('passes ollamaBaseUrl and ollamaModel to Ollama client', async () => {
    const fakeConfig = {
      getProviderConfig: () => ({
        provider: 'ollama' as const,
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'llama3.2',
      }),
    };
    const send = getSendMessage(fakeConfig as any);
    await send(fakeMessages, 'any-model', 'system prompt');
    expect(mockOllamaSend).toHaveBeenCalledWith(
      fakeMessages,
      'llama3.2',
      'http://localhost:11434',
      'system prompt',
      undefined,
      undefined
    );
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd day27 && npm test -- src/api/index.test.ts 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module './index.js'`

- [ ] **Step 3: Create src/api/index.ts**

```ts
import { sendMessage as sendMessageOpenRouter } from './openrouter.js';
import { sendMessage as sendMessageOllama } from './ollama.js';
import type { ConfigManager } from '../models/config.js';
import type { Message, ApiResponse } from '../types/index.js';
import type { MCPTool } from '../mcp/index.js';

export function getSendMessage(configManager: Pick<ConfigManager, 'getProviderConfig'>) {
  return async (
    messages: Message[],
    modelId: string,
    systemPrompt?: string,
    temperature?: number,
    tools?: MCPTool[]
  ): Promise<ApiResponse> => {
    const { provider, ollamaBaseUrl, ollamaModel } = configManager.getProviderConfig();

    if (provider === 'ollama') {
      return sendMessageOllama(messages, ollamaModel, ollamaBaseUrl, systemPrompt, temperature, tools);
    }

    return sendMessageOpenRouter(messages, modelId, systemPrompt, temperature, tools);
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd day27 && npm test -- src/api/index.test.ts 2>&1 | tail -10
```

Expected: PASS — 2 tests passing

- [ ] **Step 5: Commit**

```bash
cd day27 && git add src/api/index.ts src/api/index.test.ts && git commit -m "feat(day27): add provider-aware sendMessage wrapper"
```

---

## Task 5: Update querier.ts with initQuerier factory

**Files:**
- Modify: `src/rag/querier.ts`

- [ ] **Step 1: Add initQuerier and replace sendMessage calls**

In `src/rag/querier.ts`:

Replace the import at top:
```ts
import { sendMessage } from '../api/openrouter.js';
```

With:
```ts
import { getSendMessage } from '../api/index.js';
import type { ConfigManager } from '../models/config.js';

type SendMessageFn = ReturnType<typeof getSendMessage>;
let _sendMessage: SendMessageFn;

export function initQuerier(configManager: ConfigManager): void {
  _sendMessage = getSendMessage(configManager);
}
```

Then replace every call `sendMessage(` in the file with `_sendMessage(`.

There are 5 calls total (lines 64, 83, 161, 210-214, 275). Use search+replace in the file.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd day27 && npx tsc --noEmit 2>&1 | grep querier
```

Expected: no errors for querier.ts

- [ ] **Step 3: Update existing querier.test.ts to mock the new module path**

`querier.test.ts` currently mocks `../api/openrouter.js`. After the refactor, `querier.ts` no longer imports from there — it uses `_sendMessage` set by `initQuerier`. Update the mock and add `initQuerier` setup.

In `src/rag/querier.test.ts`, replace:

```ts
vi.mock('../api/openrouter.js', () => ({
  sendMessage: vi.fn(),
}));

import { sendMessage } from '../api/openrouter.js';
const mockSendMessage = vi.mocked(sendMessage);
```

With:

```ts
vi.mock('../api/index.js', () => ({
  getSendMessage: vi.fn(() => vi.fn()),
}));

import { getSendMessage } from '../api/index.js';
import { initQuerier } from './querier.js';
import type { ConfigManager } from '../models/config.js';

const mockSendMessageFn = vi.fn();
const mockGetSendMessage = vi.mocked(getSendMessage);

beforeEach(() => {
  mockSendMessageFn.mockReset();
  mockGetSendMessage.mockReturnValue(mockSendMessageFn);
  initQuerier({} as ConfigManager);
});
```

Then replace `mockSendMessage` with `mockSendMessageFn` in all test assertions.

- [ ] **Step 4: Run rag tests to confirm they pass**

```bash
cd day27 && npm test -- src/rag/ 2>&1 | tail -20
```

Expected: all rag tests pass

- [ ] **Step 5: Commit**

```bash
cd day27 && git add src/rag/querier.ts src/rag/querier.test.ts && git commit -m "feat(day27): use provider-aware sendMessage in querier"
```

---

## Task 6: Update Chat.tsx — switch sendMessage and add /provider command

**Files:**
- Modify: `src/components/Chat.tsx`

- [ ] **Step 1: Replace sendMessage import**

At line 5 in Chat.tsx, replace:
```ts
import { sendMessage } from '../api/openrouter.js';
```
With:
```ts
import { getSendMessage } from '../api/index.js';
```

- [ ] **Step 2: Create a local send helper inside the Chat component**

Add this line right after the `ragManager` state initialization (after line ~258, before any function definitions):

```ts
const sendMessage = getSendMessage(configManager);
```

This shadows the old import and all existing `sendMessage(...)` calls continue to work without modification.

> **Note on provider switching:** `getSendMessage` returns a closure that calls `configManager.getProviderConfig()` on every invocation (not at creation time). So when the user runs `/provider ollama`, `configManager.setProvider(...)` updates the stored config, and the next `sendMessage(...)` call will automatically use Ollama — no `useState` or `useCallback` needed.

- [ ] **Step 3: Suppress MCP tools for Ollama in tool-calling loop**

Find the tool-calling loop (around line 2183). The two `sendMessage` calls that pass `mcpTools`:

```ts
mcpTools.length > 0 ? mcpTools : undefined
```

Replace both occurrences with:

```ts
configManager.getProviderConfig().provider === 'openrouter' && mcpTools.length > 0 ? mcpTools : undefined
```

- [ ] **Step 4: Add /provider command handler**

In `handleCommand`, after the `/model remove` block (around line 730), add:

```ts
// Provider commands
if (trimmed === '/provider') {
  const { provider, ollamaModel } = configManager.getProviderConfig();
  const activeModel = provider === 'ollama' ? ollamaModel : configManager.getConfig().currentModel;
  setNotification(`Текущий провайдер: ${provider}\nМодель: ${activeModel}`);
  return true;
}

if (trimmed.startsWith('/provider ')) {
  const arg = trimmed.slice('/provider '.length).trim();

  if (arg === 'openrouter') {
    configManager.setProvider('openrouter');
    const model = configManager.getConfig().currentModel;
    setCurrentModel(model);
    setNotification(`✅ Провайдер: openrouter\nМодель: ${model}`);
    return true;
  }

  if (arg === 'ollama' || arg.startsWith('ollama ')) {
    const parts = arg.split(' ');
    const ollamaModel = parts[1] ?? configManager.getProviderConfig().ollamaModel;
    configManager.setProvider('ollama', ollamaModel);
    setCurrentModel(ollamaModel);
    setNotification(`✅ Провайдер: ollama\nМодель: ${ollamaModel}`);
    return true;
  }

  setNotification(
    'Использование:\n' +
    '/provider — текущий провайдер\n' +
    '/provider openrouter — переключить на OpenRouter\n' +
    '/provider ollama — переключить на Ollama\n' +
    '/provider ollama <model> — переключить и задать модель'
  );
  return true;
}
```

- [ ] **Step 5: Add /provider to help text**

Find the help text section (around line 1736) where `/model` commands are listed. Add after it:

```ts
🌐 Провайдер:
  /provider                 - текущий провайдер и модель
  /provider openrouter      - переключить на OpenRouter
  /provider ollama          - переключить на Ollama (текущая модель)
  /provider ollama <model>  - переключить и задать модель Ollama
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd day27 && npx tsc --noEmit 2>&1 | grep -v node_modules | head -20
```

Expected: no errors

- [ ] **Step 7: Commit**

```bash
cd day27 && git add src/components/Chat.tsx && git commit -m "feat(day27): add /provider command and Ollama routing in Chat"
```

---

## Task 7: Update index.tsx — conditional API key check and initQuerier

**Files:**
- Modify: `src/index.tsx`

- [ ] **Step 1: Update startup to handle both providers**

Replace the entire content of `src/index.tsx` with:

```ts
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import dotenv from 'dotenv';
import { Chat } from './components/Chat.js';
import { ModelRegistry } from './models/registry.js';
import { ConfigManager } from './models/config.js';
import { initQuerier } from './rag/querier.js';

dotenv.config();

(async () => {
  const configManager = new ConfigManager();
  const { provider } = configManager.getProviderConfig();

  if (provider === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
    console.error('Ошибка: OPENROUTER_API_KEY не найден в .env файле');
    console.error('Создайте .env файл на основе .env.example и укажите ваш API ключ');
    console.error('Или переключитесь на Ollama: отредактируйте config.json, установите "provider": "ollama"');
    process.exit(1);
  }

  initQuerier(configManager);

  const modelRegistry = new ModelRegistry();
  const config = configManager.getConfig();

  if (provider === 'openrouter') {
    console.log('Loading models from OpenRouter...');
    await modelRegistry.initialize();
    console.log(`Current model: ${config.currentModel}`);
  } else {
    const { ollamaModel, ollamaBaseUrl } = configManager.getProviderConfig();
    console.log(`Провайдер: Ollama (${ollamaBaseUrl})`);
    console.log(`Модель: ${ollamaModel}`);
  }

  console.log('Starting chat...\n');

  render(<Chat modelRegistry={modelRegistry} configManager={configManager} />);
})();
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd day27 && npx tsc --noEmit 2>&1 | grep -v node_modules
```

Expected: no errors

- [ ] **Step 3: Run all tests**

```bash
cd day27 && npm test 2>&1 | tail -20
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
cd day27 && git add src/index.tsx && git commit -m "feat(day27): conditional API key check, initQuerier at startup"
```

---

## Task 8: Manual smoke test

- [ ] **Step 1: Start the app with Ollama**

Make sure Ollama is running (`ollama serve` in a separate terminal). Then:

```bash
cd day27 && npm run dev
```

Expected: app starts without error, shows `Провайдер: Ollama`

- [ ] **Step 2: Test /provider command**

In the chat, type: `/provider`

Expected: shows current provider and model.

- [ ] **Step 3: Send a message to local Ollama**

Type a simple message like `привет`

Expected: response from local Ollama model, no OpenRouter API call.

- [ ] **Step 4: Switch to OpenRouter**

Type: `/provider openrouter`

Expected: confirmation message with model name.

- [ ] **Step 5: Restart and verify persistence**

Exit app (`Ctrl+C`), restart with `npm run dev`.

Expected: provider from last session is loaded from `config.json`.

---

## Demo Video Script

1. **Intro** (15s): показать `config.json` — `"provider": "openrouter"` по умолчанию
2. **Запуск** (15s): `npm run dev` — стандартный старт с OpenRouter, отправить простое сообщение
3. **Переключение на Ollama** (20s): `/provider ollama llama3.2` — показать подтверждение
4. **Ответ от локальной LLM** (30s): отправить сообщение — показать что ответ приходит без облака
5. **Переключение обратно** (15s): `/provider openrouter` — показать что переключение работает в обе стороны
6. **Персистентность** (20s): выйти, показать `config.json` что провайдер сохранился, перезапустить
