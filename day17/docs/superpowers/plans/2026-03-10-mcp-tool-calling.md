# MCP Tool Calling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate full MCP function calling so the LLM can autonomously invoke MCP tools mid-conversation, with visual feedback in the UI, plus a manual `/mcp call` command.

**Architecture:** Extend `MCPClientManager` with `callTool()`, update `sendMessage()` to accept and handle OpenAI-format `tools`, add a tool-loop in `Chat.tsx` that runs until the LLM produces a final text response, and add `activeMcpTool` state for UI visualization.

**Tech Stack:** TypeScript, Ink (React for CLI), `@modelcontextprotocol/sdk`, OpenRouter API (OpenAI-compatible function calling format)

**Spec:** `docs/superpowers/specs/2026-03-10-mcp-tool-calling-design.md`

---

## Chunk 1: Types + MCPClientManager.callTool

### Task 1: Extend types in `src/types/index.ts`

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add `ToolCall` interface and extend `Message` and `ApiResponse`**

Open `src/types/index.ts`. Add after the existing `UsageInfo` interface:

```ts
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
```

Change `Message.role` from:
```ts
role: 'user' | 'assistant' | 'system';
```
to:
```ts
role: 'user' | 'assistant' | 'system' | 'tool';
```

Add two optional fields to `Message`:
```ts
tool_call_id?: string;
tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
```

Extend `ApiResponse` — add one optional field:
```ts
toolCalls?: ToolCall[];
```

Also add `tools` and `tool_choice` to `OpenRouterRequest`:
```ts
export interface OpenRouterRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  tools?: unknown[];
  tool_choice?: 'auto';
}
```

And update `OpenRouterResponse` to handle tool_calls:
```ts
export interface OpenRouterResponse {
  choices: Array<{
    message: {
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: UsageInfo;
}
```

- [ ] **Step 2: Verify TypeScript still compiles**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day17
npm run build
```

Expected: no errors. If errors appear about `role: 'tool'` in existing code, fix by narrowing types at call sites.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add ToolCall type and extend Message/ApiResponse/OpenRouterResponse for tool calling"
```

---

### Task 2: Add `callTool()` to `MCPClientManager`

**Files:**
- Modify: `src/mcp/client.ts`

- [ ] **Step 1: Add `callTool` method**

Open `src/mcp/client.ts`. After the `listTools()` method, add:

```ts
async callTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (!this.client) throw new Error('Не подключён к MCP серверу');

  const result = await this.client.callTool({ name, arguments: args });

  const textContent = result.content.find((c: { type: string }) => c.type === 'text') as
    | { type: 'text'; text: string }
    | undefined;

  if (!textContent) throw new Error(`Инструмент "${name}" не вернул текстовый результат`);

  return textContent.text;
}
```

- [ ] **Step 2: Build to verify no type errors**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 3: Quick manual smoke test**

```bash
npm run dev
```

Type `/mcp` — confirm connection still works and tools list appears. Type `/mcp disconnect`. Exit with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/client.ts
git commit -m "feat: add callTool() to MCPClientManager"
```

---

## Chunk 2: OpenRouter tool calling support

### Task 3: Extend request path — send tools to OpenRouter

**Files:**
- Modify: `src/api/openrouter.ts`
- Modify: `src/mcp/index.ts` (re-export MCPTool for import)

- [ ] **Step 1: Add `MCPTool` to MCP exports**

Open `src/mcp/index.ts`. Verify it already exports `MCPTool` (it should from existing code). If not, add:
```ts
export type { MCPTool } from './client.js';
```

- [ ] **Step 2: Add import and helper type to `openrouter.ts`**

Open `src/api/openrouter.ts`. Add at the top, after existing imports:

```ts
import { ToolCall } from '../types/index.js';
import type { MCPTool } from '../mcp/index.js';

interface OpenRouterTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}
```

- [ ] **Step 3: Update function signature to accept `tools`**

Change:
```ts
export async function sendMessage(
  messages: Message[],
  modelId: string,
  systemPrompt?: string,
  temperature?: number
): Promise<ApiResponse>
```

to:
```ts
export async function sendMessage(
  messages: Message[],
  modelId: string,
  systemPrompt?: string,
  temperature?: number,
  tools?: MCPTool[]
): Promise<ApiResponse>
```

- [ ] **Step 4: Build `allMessages` with tool-calling fields**

Find the existing `allMessages` construction:
```ts
const allMessages: Message[] = systemPrompt
  ? [{ role: 'system', content: systemPrompt }, ...messages]
  : messages;
```

Replace it with a version that passes through `tool_call_id` and `tool_calls` fields needed for multi-turn tool calling:
```ts
const allMessages = (systemPrompt
  ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
  : messages
).map((m) => {
  const msg: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
  if (m.tool_calls) msg.tool_calls = m.tool_calls;
  return msg;
});
```

- [ ] **Step 5: Convert MCPTool list to OpenRouter format and add to request body**

After the `allMessages` construction, add:

```ts
const openRouterTools: OpenRouterTool[] | undefined =
  tools && tools.length > 0
    ? tools.map((tool) => {
        // MCP inputSchema may be a flat map of property names to zod schemas,
        // or already a JSON Schema object. Wrap in a standard JSON Schema envelope.
        const hasProperties = tool.inputSchema && Object.keys(tool.inputSchema).length > 0;
        return {
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: hasProperties
              ? {
                  type: 'object',
                  properties: tool.inputSchema,
                  // Do NOT mark all as required — let the LLM decide based on descriptions
                }
              : { type: 'object', properties: {} },
          },
        };
      })
    : undefined;
```

Update `requestBody` to include tools when present:
```ts
const requestBody: OpenRouterRequest = {
  model: modelId,
  messages: allMessages as Message[],
  ...(temperature !== undefined && { temperature }),
  ...(openRouterTools && { tools: openRouterTools, tool_choice: 'auto' }),
};
```

- [ ] **Step 6: Build to verify no errors**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 7: Commit request path changes**

```bash
git add src/api/openrouter.ts src/mcp/index.ts
git commit -m "feat: extend sendMessage() request path with OpenRouter function calling tools"
```

---

### Task 4: Extend response path — parse tool_calls from OpenRouter response

**Files:**
- Modify: `src/api/openrouter.ts`

- [ ] **Step 1: Parse `tool_calls` from the API response**

In `openrouter.ts`, find the existing return block:
```ts
return {
  content: data.choices[0].message.content,
  usage: data.usage,
  responseTime,
};
```

Replace with:
```ts
const choice = data.choices[0];
const rawToolCalls = choice.message.tool_calls;
const finishReason = choice.finish_reason;

// Populate toolCalls when LLM signals it wants to call tools
const toolCalls: ToolCall[] | undefined =
  (finishReason === 'tool_calls' || (rawToolCalls && rawToolCalls.length > 0))
    ? rawToolCalls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: (() => {
          try {
            return JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            return {};
          }
        })(),
      }))
    : undefined;

return {
  content: choice.message.content ?? '',
  usage: data.usage,
  responseTime,
  toolCalls,
};
```

- [ ] **Step 2: Build to verify**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/api/openrouter.ts
git commit -m "feat: parse tool_calls in sendMessage() response for MCP tool-calling loop"
```

---

## Chunk 3: Chat.tsx — tool-loop, UI, manual command, help

### Task 5: Add `activeMcpTool` state and UI indicator

**Files:**
- Modify: `src/components/Chat.tsx`

- [ ] **Step 1: Add `activeMcpTool` state**

In `Chat.tsx`, find the block of `useState` declarations (around line 197–225). Add:

```ts
const [activeMcpTool, setActiveMcpTool] = useState<string | null>(null);
```

- [ ] **Step 2: Update loading indicator in JSX**

Find the loading indicator section (around line 1703):
```tsx
{isLoading && (
  <Box>
    <Text bold color="blue">
      Assistant:{' '}
    </Text>
    <Text dimColor>[загрузка...]</Text>
  </Box>
)}
```

Replace with:
```tsx
{isLoading && (
  <Box>
    <Text bold color="blue">
      Assistant:{' '}
    </Text>
    {activeMcpTool ? (
      <Text color="magenta">🔧 Вызов MCP: {activeMcpTool}...</Text>
    ) : (
      <Text dimColor>[загрузка...]</Text>
    )}
  </Box>
)}
```

- [ ] **Step 3: Build to verify**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add activeMcpTool state and MCP tool call indicator in Chat UI"
```

---

### Task 6: Replace single `sendMessage` call with tool-loop

**Files:**
- Modify: `src/components/Chat.tsx`
- Modify: `src/api/openrouter.ts` (update import used in Chat)

- [ ] **Step 1: Import `MCPTool` type in `Chat.tsx`**

Find the existing MCP import line:
```ts
import { MCPClientManager } from '../mcp/index.js';
```

Replace with:
```ts
import { MCPClientManager, MCPTool } from '../mcp/index.js';
```

- [ ] **Step 2: Replace the main `sendMessage` call with a tool-loop**

Find this exact block in `Chat.tsx` (around line 1450):
```ts
const apiResponse = await sendMessage(
  apiMessages,
  currentModel,
  systemPrompt,
  temperature
);
```

Replace it with the following tool-loop. The variable name `apiResponse` is preserved so all code below (invariant check, metadata, stats) continues to work unchanged. Tool messages are kept only in `loopMessages` and are NOT added to the persistent `conversation` history:

```ts
// Get MCP tools if connected (enables LLM-driven tool calling)
const mcpTools: MCPTool[] = mcpManager.isConnected()
  ? await mcpManager.listTools()
  : [];

// Tool-calling loop: repeat until LLM produces a final text response
// loopMessages is a local copy — tool turns are NOT persisted to conversation history
let loopMessages = [...apiMessages];
let apiResponse = await sendMessage(
  loopMessages,
  currentModel,
  systemPrompt,
  temperature,
  mcpTools.length > 0 ? mcpTools : undefined
);

const MAX_TOOL_ITERATIONS = 10;
let toolIteration = 0;

while (apiResponse.toolCalls && apiResponse.toolCalls.length > 0 && toolIteration < MAX_TOOL_ITERATIONS) {
  toolIteration++;

  // Add assistant turn (with tool_calls) to loop context only
  loopMessages.push({
    role: 'assistant',
    content: apiResponse.content ?? '',
    tool_calls: apiResponse.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    })),
  });

  // Execute each tool call and append tool results to loop context
  for (const toolCall of apiResponse.toolCalls) {
    setActiveMcpTool(toolCall.name);

    let toolResult: string;
    try {
      toolResult = await mcpManager.callTool(toolCall.name, toolCall.arguments);
    } catch (err) {
      toolResult = `Ошибка вызова инструмента: ${err instanceof Error ? err.message : String(err)}`;
    }

    // role: 'tool' message is added to loopMessages only, not to conversation history
    loopMessages.push({
      role: 'tool',
      content: toolResult,
      tool_call_id: toolCall.id,
    });
  }

  setActiveMcpTool(null);

  // Ask LLM for next response (may produce another tool call or final answer)
  apiResponse = await sendMessage(
    loopMessages,
    currentModel,
    systemPrompt,
    temperature,
    mcpTools.length > 0 ? mcpTools : undefined
  );
}

// Ensure indicator is cleared even if loop exits due to MAX_TOOL_ITERATIONS
setActiveMcpTool(null);
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: clean build. Fix any type errors (e.g., `role: 'tool'` narrowing issues).

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat: implement MCP tool-calling loop in Chat.tsx (LLM-driven tool use)"
```

---

### Task 7: Add `/mcp call` manual command and update `/help`

**Files:**
- Modify: `src/components/Chat.tsx`

- [ ] **Step 1: Add `/mcp call` handler in `handleCommand()`**

Find the MCP commands block in `handleCommand()`. After the `/mcp disconnect` handler and before `return false`, add:

```ts
if (trimmed.startsWith('/mcp call')) {
  const rest = trimmed.slice('/mcp call'.length).trim();
  if (!rest) {
    setNotification(
      'Использование: /mcp call <инструмент> [json-аргументы]\n' +
      'Пример: /mcp call get_time\n' +
      'Пример: /mcp call echo {"message":"привет"}'
    );
    return true;
  }

  // Parse: first token = tool name, rest = optional JSON args
  const spaceIdx = rest.indexOf(' ');
  const toolName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  const argsStr = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();

  let args: Record<string, unknown> = {};
  if (argsStr) {
    try {
      args = JSON.parse(argsStr) as Record<string, unknown>;
    } catch {
      setNotification(`❌ Неверный JSON: ${argsStr}`);
      return true;
    }
  }

  try {
    if (!mcpManager.isConnected()) {
      setNotification('⏳ Подключение к MCP серверу...');
      await mcpManager.connect();
    }

    setNotification(`⏳ Вызов инструмента: ${toolName}...`);
    const result = await mcpManager.callTool(toolName, args);
    setNotification(`🔧 ${toolName}:\n\n${result}`);
  } catch (err) {
    setNotification(
      `❌ Ошибка вызова инструмента: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return true;
}
```

- [ ] **Step 2: Update `/help` MCP section**

Find the MCP section in the help text string:
```ts
📡 MCP:
  /mcp                      - подключиться и показать инструменты
  /mcp disconnect           - отключиться от сервера
```

Replace with:
```ts
📡 MCP:
  /mcp                           - подключиться и показать инструменты
  /mcp disconnect                - отключиться от сервера
  /mcp call <инструмент>         - вызвать инструмент вручную
  /mcp call <инструмент> <json>  - вызвать инструмент с параметрами
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add /mcp call manual command and update /help docs"
```

---

### Task 8: End-to-end manual verification

**No automated test framework is installed. Verify manually.**

- [ ] **Step 1: Start the agent and verify MCP server is up**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day17
npm start
```

Type `/mcp`. Expected:
```
✅ MCP сервер подключён

Доступные инструменты (3):

🔧 get_time
   Возвращает текущее дату и время

🔧 echo
   Повторяет переданное сообщение

🔧 get_agent_info
   Возвращает информацию о CLI агенте
```

If the tool list does not appear or differs, stop here and check `src/mcp/server.ts`.

- [ ] **Step 2: Verify `/help` shows new MCP commands**

Type `/help`. Expected in MCP section:
```
📡 MCP:
  /mcp                           - подключиться и показать инструменты
  /mcp disconnect                - отключиться от сервера
  /mcp call <инструмент>         - вызвать инструмент вручную
  /mcp call <инструмент> <json>  - вызвать инструмент с параметрами
```

- [ ] **Step 3: Test manual tool call — no args**

Type `/mcp call get_time`.

Expected: notification shows current date/time string from MCP server.

- [ ] **Step 4: Test manual tool call — with JSON args**

Type `/mcp call echo {"message":"привет от ручного вызова"}`.

Expected: notification shows `echo:\n\nпривет от ручного вызова`.

- [ ] **Step 5: Test LLM-driven tool call — get_time**

Type (natural language): `который сейчас час?`

Expected sequence:
1. While waiting: loading indicator shows `🔧 Вызов MCP: get_time...`
2. Final assistant message in chat contains the current time value

- [ ] **Step 6: Test LLM-driven tool call — echo**

Type: `повтори фразу "hello world" используя инструмент echo`

Expected: assistant invokes `echo` tool and incorporates the returned text into its response.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-03-10-mcp-tool-calling.md
git commit -m "chore: mark verification steps complete in MCP tool calling plan"
```
