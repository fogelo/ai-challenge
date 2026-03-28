# Design: Local LLM Integration via Ollama

**Date:** 2026-03-24
**Status:** Approved

## Overview

Integrate Ollama as a local LLM provider into the existing CLI agent (TypeScript + Ink). The app must work without cloud models. Users can switch between OpenRouter (cloud) and Ollama (local) via `/provider` commands. The selected provider persists across sessions via `config.json`.

## Architecture

### New file: `src/api/ollama.ts`

Exports a single function with the same signature as `src/api/openrouter.ts`:

```ts
export async function sendMessage(
  messages: Message[],
  modelId: string,
  systemPrompt?: string,
  temperature?: number,
  tools?: MCPTool[]
): Promise<ApiResponse>
```

Sends requests to `{ollamaBaseUrl}/v1/chat/completions` (Ollama's OpenAI-compatible endpoint). No API key required. Reuses existing `Message`, `ApiResponse`, `ToolCall` types unchanged.

### New file: `src/api/index.ts`

Exports a provider-aware `sendMessage` wrapper:

```ts
export function getSendMessage(configManager: ConfigManager) {
  return (messages, modelId, systemPrompt?, temperature?, tools?) => {
    const { provider, ollamaBaseUrl, ollamaModel } = configManager.getProviderConfig();
    if (provider === 'ollama') {
      return sendMessageOllama(messages, ollamaModel, ollamaBaseUrl, systemPrompt, temperature, tools);
    }
    return sendMessageOpenRouter(messages, modelId, systemPrompt, temperature, tools);
  };
}
```

Both `Chat.tsx` and `src/rag/querier.ts` import from `../api/index.js` instead of `../api/openrouter.js`. This ensures RAG queries also use the active provider.

Note: `ollama.ts`'s `sendMessage` signature adds `baseUrl: string` as the third parameter (after `modelId`) so the base URL flows through from config.

### Changes to `src/models/config.ts`

Add three fields to `ModelConfig` type and `DEFAULT_CONFIG`:

```ts
provider: 'openrouter' | 'ollama'   // default: 'openrouter'
ollamaBaseUrl: string               // default: 'http://localhost:11434'
ollamaModel: string                 // default: 'llama3.2'
```

Add methods to `ConfigManager`:
- `getProviderConfig()` — returns `{ provider, ollamaBaseUrl, ollamaModel }`
- `setProvider(provider, ollamaModel?)` — updates both fields and saves

### Changes to `src/components/Chat.tsx`

1. **Import**: replace `import { sendMessage } from '../api/openrouter.js'` with `import { getSendMessage } from '../api/index.js'`
2. **Dispatch**: use `getSendMessage(configManager)(...)` for all LLM calls
3. **`currentModel` state**: on `/provider ollama <model>`, call `setCurrentModel(ollamaModel)` so the status bar shows the correct model name. Cost calculation will return `0` for Ollama models (not in registry) — this is acceptable and already handled gracefully by `calculateCost`.
4. **MCP tools**: when provider is Ollama, pass `tools: undefined` to suppress tool-calling. Ollama's tool support is model-dependent and unreliable; disabling it avoids hangs and confusing errors.
5. **Command handler** (`handleCommand`): add `/provider` command block with sub-commands
6. **Help text**: add `/provider` to the commands list

### Changes to `src/rag/querier.ts`

Use module-level initialization pattern:

```ts
import { getSendMessage } from '../api/index.js';

let _sendMessage: ReturnType<typeof getSendMessage>;

export function initQuerier(configManager: ConfigManager): void {
  _sendMessage = getSendMessage(configManager);
}
```

All internal calls to `sendMessage(...)` inside `querier.ts` (`ragQuery`, `rewriteQuery`, `ragQueryEnhanced`, `ragQueryCited`, `ragQueryWithHistory`) are replaced with `_sendMessage(...)`. Public function signatures remain unchanged — no call sites in `Chat.tsx` need updating.

`initQuerier(configManager)` is called once during app startup in `src/index.tsx` (or wherever `RagManager` is initialized).

## `/provider` Commands

| Input | Action |
|---|---|
| `/provider` | Show current provider and active model |
| `/provider openrouter` | Switch to OpenRouter; saves to config |
| `/provider ollama` | Switch to Ollama with current `ollamaModel`; saves to config |
| `/provider ollama <model>` | Switch to Ollama and set model (e.g. `llama3.2`); saves to config |

Feedback is shown via `setNotification(...)` as a system message in the chat UI.

## Data Flow

```
User input → handleCommand('/provider ollama llama3.2')
  → configManager.setProvider('ollama', 'llama3.2')
  → config.json updated
  → setNotification('Провайдер: ollama (llama3.2)')

User message → handleSendMessage()
  → getSendMessage(configManager)(messages, currentModel, ...)
  → getProviderConfig() → { provider: 'ollama', ollamaBaseUrl: 'http://localhost:11434', ollamaModel: 'llama3.2' }
  → sendMessageOllama(messages, 'llama3.2', 'http://localhost:11434', ...)
  → Ollama at http://localhost:11434/v1/chat/completions
  → ApiResponse → render in UI
```

## Error Handling

- If Ollama is not running: fetch throws `ECONNREFUSED` → caught in existing try/catch in Chat.tsx → shown as error notification
- If model not found in Ollama: Ollama returns 404 → error text shown in UI
- MCP tool-calling is disabled for Ollama (tools: undefined passed) to avoid model-compatibility issues

## Config Persistence

`config.json` gains new fields. Backward compatibility: `ConfigManager.load()` already applies defaults for missing fields — the same pattern is used here.

```json
{
  "provider": "openrouter",
  "ollamaBaseUrl": "http://localhost:11434",
  "ollamaModel": "llama3.2",
  "currentModel": "anthropic/claude-3.5-sonnet",
  ...
}
```

## Files Changed

| File | Change |
|---|---|
| `src/api/ollama.ts` | **New** — Ollama API client |
| `src/api/index.ts` | **New** — Provider-aware `getSendMessage` wrapper |
| `src/models/config.ts` | Add 3 fields + `getProviderConfig()` + `setProvider()` to ConfigManager |
| `src/types/index.ts` | Add `provider`, `ollamaBaseUrl`, `ollamaModel` to `ModelConfig` type |
| `src/components/Chat.tsx` | Switch to `getSendMessage`, add `/provider` command, suppress tools for Ollama |
| `src/rag/querier.ts` | Add `initQuerier(configManager)`, replace internal `sendMessage` calls with `_sendMessage` |
| `src/index.tsx` | Call `initQuerier(configManager)` at startup |

## Demo Script

1. Start app normally (OpenRouter active)
2. Run `/provider` → shows "openrouter"
3. Run `/provider ollama llama3.2` → confirmation shown
4. Send a message → response comes from local Ollama
5. Run `/provider openrouter` → switch back to cloud
6. Restart app → Ollama still selected (persisted)
