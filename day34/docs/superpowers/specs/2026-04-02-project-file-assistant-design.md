# Design: Project File Assistant (Day 34)

**Date:** 2026-04-02
**Status:** Approved

## Overview

A new MCP server (`server-project.ts`) that gives the agent active read/write/search capabilities over a project directory. The agent initiates file work autonomously based on high-level goals — the user does not have to say "open file X".

## Architecture

### New file: `src/mcp/server-project.ts`

Standalone MCP server registered alongside existing servers in `client.ts`. Project root is configured via `PROJECT_ROOT` environment variable (fallback: `process.cwd()`). All file paths are sandboxed — path traversal outside PROJECT_ROOT is rejected.

### Registration

Add `{ name: 'server-project', file: 'server-project.js' }` to `MCPClientManager.SERVERS` in `src/mcp/client.ts`.

### Environment

Add `PROJECT_ROOT=.` to `.env.example`.

## Tools

| Tool | Description |
|---|---|
| `readProjectFile` | Read file content by relative path within PROJECT_ROOT |
| `searchInFiles` | Search for a regex pattern across files matching a glob filter |
| `listProjectFiles` | List files matching a glob pattern (e.g. `src/**/*.ts`) |
| `writeProjectFile` | Create or overwrite a file at a relative path |
| `generateDiff` | Generate a unified diff between old and new content strings |

### Security

- All paths resolved with `path.resolve(PROJECT_ROOT, relativePath)`
- Reject any resolved path that does not start with `PROJECT_ROOT`
- `writeProjectFile` does not allow overwriting files outside PROJECT_ROOT

## Demo Scenarios

Both scenarios are reproducible by giving the agent a goal-level instruction.

### Scenario 1: Find all usages of an API

**Trigger:** User says "найди все места где используется callTool"
**Agent behavior:**
1. Calls `listProjectFiles` with glob `src/**/*.ts`
2. Calls `searchInFiles` with pattern `callTool` and glob `src/**/*.ts`
3. Returns formatted list of files and matching lines

### Scenario 2: Generate CHANGELOG

**Trigger:** User says "сгенерируй changelog проекта"
**Agent behavior:**
1. Calls `readProjectFile` on `README.md`, `package.json`, `src/mcp/client.ts`
2. Analyzes content and writes summary
3. Calls `writeProjectFile` to save `output/CHANGELOG.md`
4. Returns path to generated file

## Data Flow

```
User goal → LLM decides which tools to call → server-project.ts executes fs operations → results returned to LLM → LLM synthesizes answer
```

## Error Handling

- File not found → descriptive error message returned as tool result (no crash)
- Path traversal attempt → reject with error
- Binary files → skip or return size info only

## Testing

Run both demo scenarios manually after implementation and verify:
- Scenario 1 returns file:line results for `callTool`
- Scenario 2 creates `output/CHANGELOG.md` with content based on read files
