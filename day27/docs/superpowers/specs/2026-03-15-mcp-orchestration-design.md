# MCP Orchestration — Design Spec
**Date:** 2026-03-15
**Project:** day20 CLI Agent
**Goal:** Day 20 assignment — register multiple MCP servers, route tool calls correctly, execute long multi-server flows

---

## Problem

The current agent has a single monolithic MCP server (`server.ts`) with all tools bundled together. The Day 20 assignment requires:
- Multiple MCP servers registered simultaneously
- Agent selects the right tool from the right server
- Correct routing of requests
- A long flow using tools from different servers
- Visual proof (for video demo) that different servers are being called

---

## Architecture

### 1. Server Split

The existing `server.ts` is split into 4 domain-specific servers:

| File | Server Name | Tools |
|---|---|---|
| `src/mcp/server-web.ts` | `server-web` | `search` |
| `src/mcp/server-ai.ts` | `server-ai` | `summarize` |
| `src/mcp/server-files.ts` | `server-files` | `saveToFile`, `readFile`, `listFiles` |
| `src/mcp/server-utils.ts` | `server-utils` | `get_time`, `echo`, `get_agent_info`, `git_status`, `git_log`, `git_diff`, `get_todos`, `get_posts`, `get_user`, `create_reminder`, `list_reminders`, `cancel_reminder`, `check_fired_reminders` |

The old `server.ts` is deleted.

### 2. MCPClientManager (multi-server)

`src/mcp/client.ts` is updated to manage multiple server connections:

```typescript
interface ServerConfig {
  name: string;   // e.g. 'server-web'
  file: string;   // e.g. 'server-web.js'
}

interface MCPToolWithServer extends MCPTool {
  serverName: string;
}
```

- `connect()` starts all 4 server processes simultaneously
- `listTools()` aggregates tools from all servers, each tagged with `serverName`
- `callTool(name, args)` looks up which server owns the tool and routes the call there
- `disconnect()` closes all connections
- Internal tool `check_fired_reminders` stays hidden from LLM (existing behavior)

### 3. Visual Attribution (Approach C)

**Status indicator** (existing `activeMcpTool` state):
```
⏳ [server-web] search...
```

**Chat message** after each tool call (new):
```
🔧 server-web › search
   → url
   ✅ [result preview]
```

Tool call messages are added to the UI message list but NOT sent to the LLM (to avoid context pollution). They use a new `role: 'tool-call'` display type, rendered differently in `Chat.tsx`.

### 4. Data Flow

```
User message
    ↓
LLM (with aggregated tool list from all 4 servers)
    ↓ tool_call: "search"
MCPClientManager.callTool("search", args)
    → looks up: search belongs to server-web
    → routes to server-web Client
    ↓ result
Show [server-web › search] in chat + status
    ↓
LLM (with tool result)
    ↓ tool_call: "summarize"
MCPClientManager.callTool("summarize", args)
    → routes to server-ai
    ↓ result
Show [server-ai › summarize] in chat + status
    ↓
LLM
    ↓ tool_call: "saveToFile"
MCPClientManager.callTool("saveToFile", args)
    → routes to server-files
    ↓ result
Show [server-files › saveToFile] in chat + status
    ↓
LLM final text response
```

---

## Demo Scenario (for video)

```
User: "Скачай страницу https://docs.anthropic.com/en/home,
       суммаризируй на русском и сохрани в файл anthropic.md"

🔧 server-web › search
   → https://docs.anthropic.com/en/home
🔧 server-ai › summarize
   → [text from search]
🔧 server-files › saveToFile
   → anthropic.md
```

Three different servers, three sequential tool calls — clearly visible in chat.

---

## Files Changed

- **Deleted:** `src/mcp/server.ts`
- **Added:** `src/mcp/server-web.ts`, `src/mcp/server-ai.ts`, `src/mcp/server-files.ts`, `src/mcp/server-utils.ts`
- **Modified:** `src/mcp/client.ts` — multi-server support
- **Modified:** `src/components/Chat.tsx` — server attribution display
- **Modified:** `src/mcp/index.ts` — updated exports
- **Updated:** `DEMO_MCP.md` — new demo scenario

---

## Out of Scope

- Dynamic server registration at runtime
- Server health checks / reconnection logic
- Authentication between servers
