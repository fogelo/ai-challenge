# Code Review Pipeline — Design Spec
**Date:** 2026-03-31
**Day:** 32

## Overview

Automated code review pipeline that runs on every PR. The assistant receives a git diff, enriches context via RAG (project docs), and returns structured review output with bugs, architectural issues, and recommendations. Results are posted as a PR comment and printed to stdout.

---

## Architecture

### New files

```
src/review/
├── CodeReviewer.ts      # Coordinator: orchestrates diff parsing, RAG, LLM call
├── diff-parser.ts       # Parses unified diff → file list, hunks, summary
└── prompt-builder.ts    # Assembles LLM prompt from diff + file contents + RAG results

review-cli.ts            # Entry point for GitHub Action / local runs

.github/
└── workflows/
    └── code-review.yml  # GitHub Actions workflow triggered on pull_request
```

### Reused from existing codebase

- `src/rag/RagManager.ts` — RAG search over indexed docs
- `src/api/openrouter.ts` — LLM calls via OpenRouter
- `src/rag/indexer.ts` / `src/rag/embedder.ts` — existing index infrastructure

---

## Data Flow

```
PR opened → GitHub Action
  → git diff origin/main...HEAD > diff.patch
  → node dist/review-cli.js --diff diff.patch --repo .
       → diff-parser.ts    → ParsedDiff { files, hunks, summary }
       → read full content of changed files
       → RagManager.search(summary, topK=6)  → relevant doc chunks
       → prompt-builder.ts → assembled LLM prompt
       → openrouter.ts     → LLM → ReviewResult (JSON)
  → stdout (Markdown formatted)
  → if GITHUB_TOKEN + PR_NUMBER → post PR comment via GitHub API
```

---

## Interfaces

### `ParsedDiff`
```ts
interface FileDiff {
  path: string;
  hunks: string;   // raw diff hunks for this file
}

interface ParsedDiff {
  files: string[];       // list of changed file paths
  fileDiffs: FileDiff[]; // per-file diff content
  summary: string;       // short text description for RAG query
}
```

### `ReviewResult`
```ts
interface ReviewResult {
  bugs: string[];
  architectural_issues: string[];
  recommendations: string[];
}
```

### `CodeReviewer`
```ts
class CodeReviewer {
  constructor(ragManager: RagManager, model: string)
  async review(diff: string, repoPath: string): Promise<ReviewResult>
}
```

---

## Components

### `diff-parser.ts`
- Parses unified diff format
- Extracts list of changed files (`+++ b/path` lines)
- Groups hunks per file
- Generates a short natural-language summary for RAG query (e.g. "changes in src/rag/querier.ts, src/chat/conversation.ts")

### `prompt-builder.ts`
- Accepts: diff, file contents map, RAG results
- Truncates file contents if too large (max ~2000 chars per file)
- Returns system prompt + user prompt
- System prompt instructs LLM to return valid JSON with keys: `bugs`, `architectural_issues`, `recommendations`

### `CodeReviewer.ts`
- Instantiates `RagManager` with existing index path
- Calls `diff-parser.ts` → reads changed files from disk → calls `prompt-builder.ts`
- Calls `openrouter.ts` with assembled messages
- Parses JSON response → `ReviewResult`
- Falls back gracefully if JSON parse fails (wraps raw text in `recommendations`)

### `review-cli.ts`
- CLI entry point (not part of the interactive agent)
- Args: `--diff <path>` (required), `--repo <path>` (default: `.`)
- Loads `.env` for `OPENROUTER_API_KEY`
- Calls `CodeReviewer.review()`
- Formats output as Markdown to stdout
- If `GITHUB_TOKEN` and `PR_NUMBER` env vars are set → posts comment to PR via `https://api.github.com/repos/{owner}/{repo}/issues/{pr}/comments`

### `.github/workflows/code-review.yml`
- Trigger: `pull_request` (types: opened, synchronize)
- Steps:
  1. `actions/checkout@v4` with `fetch-depth: 0`
  2. `actions/setup-node@v4` with Node 20
  3. `npm ci`
  4. `npm run build`
  5. `git diff origin/${{ github.base_ref }}...HEAD > diff.patch`
  6. `node dist/review-cli.js --diff diff.patch`
- Env: `OPENROUTER_API_KEY` from repository secrets, `GITHUB_TOKEN` from `secrets.GITHUB_TOKEN`, `PR_NUMBER` from `github.event.pull_request.number`

---

## Error Handling

- Missing diff file → exit with clear error message
- Empty diff → print "No changes detected, skipping review"
- LLM returns invalid JSON → wrap raw response, still output review
- RAG index not found → skip RAG, review with diff only (warn user)
- GitHub API post fails → log warning, do not fail the Action (review still in logs)

---

## Out of Scope

- Line-level comments on specific diff lines (GitHub Review API) — too complex for day32
- Indexing changed files into RAG (only docs are indexed)
- Multiple PR providers (GitLab, Bitbucket)
