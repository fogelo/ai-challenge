# MCP Tool Calling — Design Spec

**Date:** 2026-03-10
**Scope:** Day 17 — Full MCP function calling integration

## Goal

Enable the CLI agent to call MCP tools in two ways:
1. **LLM-driven** — the LLM decides when to call a tool via OpenRouter function calling API
2. **Manual** — the user calls `/mcp call <tool> [json-args]` directly

Plus a visual indicator in the UI showing which tool is currently being invoked.

## Architecture & Data Flow

```
User: "который час?"
  └→ Chat.tsx builds tools list from mcpManager.listTools()
  └→ sendMessage(messages, tools=[get_time, echo, get_agent_info])
       └→ OpenRouter API returns { tool_calls: [{ name: "get_time", id: "call_1" }] }
  └→ UI shows "🔧 Вызов MCP: get_time..."
  └→ mcpManager.callTool("get_time", {}) → "10 марта 2026, 14:32"
  └→ sendMessage(messages + tool_result, tools=[...])
       └→ OpenRouter API returns "Сейчас 14:32, 10 марта 2026"
  └→ Final answer shown in chat
```

## Files Changed

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `ToolCall`, `tool` role to `Message`, `tool_call_id` field, extend `ApiResponse` |
| `src/mcp/client.ts` | Add `callTool(name, args)` method |
| `src/api/openrouter.ts` | Accept `tools` param, handle `tool_calls` in response |
| `src/components/Chat.tsx` | Tool-loop logic, `activeMcpTool` state, `/mcp call` command, update `/help` |

## New Types (`src/types/index.ts`)

```ts
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// Message.role gains 'tool'
// Message gains optional tool_call_id?: string

// ApiResponse gains optional toolCalls?: ToolCall[]
```

## MCPClientManager.callTool

```ts
async callTool(name: string, args: Record<string, unknown>): Promise<string>
```

- Throws if not connected
- Returns the first `content[].text` from the MCP tool response

## sendMessage Changes

New optional parameter: `tools?: MCPTool[]`

- When provided, converts MCPTool list to OpenRouter `tools` format:
  ```json
  { "type": "function", "function": { "name": "...", "description": "...", "parameters": {...} } }
  ```
- `ApiResponse.toolCalls` is populated when `finish_reason === "tool_calls"`
- Tool result messages use `role: "tool"` with `tool_call_id`

## Tool-Loop in Chat.tsx

Replaces single `sendMessage` call with a loop:

```
setActiveMcpTool(null)
loop:
  response = sendMessage(messages, tools)
  if response.toolCalls:
    for each toolCall:
      setActiveMcpTool(toolCall.name)
      result = mcpManager.callTool(toolCall.name, toolCall.arguments)
      append tool_result message
  else:
    save assistant message
    break
setActiveMcpTool(null)
```

Max iterations: 10 (prevent infinite loops).

## UI Visualization

New state: `activeMcpTool: string | null`

In the loading indicator area:
- `isLoading && !activeMcpTool` → `[загрузка...]` (current behavior)
- `isLoading && activeMcpTool` → `🔧 Вызов MCP: get_time...` (new)

## Manual Command `/mcp call`

```
/mcp call get_time
/mcp call echo {"message": "привет"}
```

- Requires MCP to be connected (auto-connects if not)
- Shows result in notification area
- Parses optional JSON args; defaults to `{}`

## Help Text Update

In `/help` output, the MCP section expands to:

```
📡 MCP:
  /mcp                         - подключиться и показать инструменты
  /mcp disconnect              - отключиться от сервера
  /mcp call <tool>             - вызвать инструмент вручную
  /mcp call <tool> <json>      - вызвать инструмент с параметрами
```

## Constraints

- MCP must be connected for LLM tool calling to work (auto-connect on first user message if tools available, or warn)
- Tool calling only activates if MCP is connected; otherwise normal chat
- `role: "tool"` messages are not persisted to session history (they are ephemeral within the tool-loop)
