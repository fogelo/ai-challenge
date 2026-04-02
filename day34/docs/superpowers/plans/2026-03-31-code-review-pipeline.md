# Code Review Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated PR code review pipeline that gets a git diff, uses RAG over project docs, and returns structured review output (bugs, architectural issues, recommendations) — runnable locally and via GitHub Actions.

**Architecture:** A `CodeReviewer` class in `src/review/` coordinates diff parsing, file reading, RAG search, and LLM call. A standalone CLI entry point `src/review-cli.ts` handles args, formats output, and posts a GitHub PR comment. A GitHub Actions workflow triggers on pull_request and calls the CLI.

**Tech Stack:** TypeScript, existing `RagManager` + `sendMessage` from the codebase, Vitest for tests, GitHub Actions.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/review/diff-parser.ts` | Create | Parse unified diff → file list + hunks + summary |
| `src/review/prompt-builder.ts` | Create | Assemble LLM prompt from diff, file contents, RAG results |
| `src/review/CodeReviewer.ts` | Create | Orchestrate review: parse → read files → RAG → LLM → parse result |
| `src/review-cli.ts` | Create | CLI entry point: args, format output, post GitHub comment |
| `.github/workflows/code-review.yml` | Create | GitHub Actions workflow triggered on pull_request |
| `tests/review/diff-parser.test.ts` | Create | Unit tests for diff-parser |
| `tests/review/prompt-builder.test.ts` | Create | Unit tests for prompt-builder |

---

## Task 1: `src/review/diff-parser.ts`

**Files:**
- Create: `src/review/diff-parser.ts`
- Test: `tests/review/diff-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/review/diff-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDiff } from '../../src/review/diff-parser.js';

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
-  return 1;
+  return 2;
+  // changed
 }
diff --git a/src/bar.ts b/src/bar.ts
index 111..222 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -5,6 +5,7 @@
 export function bar() {
+  console.log('added');
 }`;

describe('parseDiff', () => {
  it('extracts changed file paths', () => {
    const result = parseDiff(SAMPLE_DIFF);
    expect(result.files).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('creates fileDiffs with hunks per file', () => {
    const result = parseDiff(SAMPLE_DIFF);
    expect(result.fileDiffs).toHaveLength(2);
    expect(result.fileDiffs[0].path).toBe('src/foo.ts');
    expect(result.fileDiffs[0].hunks).toContain('@@ -1,3 +1,4 @@');
  });

  it('generates a natural-language summary', () => {
    const result = parseDiff(SAMPLE_DIFF);
    expect(result.summary).toContain('src/foo.ts');
    expect(result.summary).toContain('src/bar.ts');
  });

  it('returns empty result for empty diff', () => {
    const result = parseDiff('');
    expect(result.files).toEqual([]);
    expect(result.fileDiffs).toEqual([]);
    expect(result.summary).toBe('no changes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd day32 && npx vitest run tests/review/diff-parser.test.ts
```

Expected: FAIL — `Cannot find module '../../src/review/diff-parser.js'`

- [ ] **Step 3: Write implementation**

Create `src/review/diff-parser.ts`:

```ts
export interface FileDiff {
  path: string;
  hunks: string;
}

export interface ParsedDiff {
  files: string[];
  fileDiffs: FileDiff[];
  summary: string;
}

export function parseDiff(rawDiff: string): ParsedDiff {
  if (!rawDiff.trim()) {
    return { files: [], fileDiffs: [], summary: 'no changes' };
  }

  const lines = rawDiff.split('\n');
  const fileDiffsMap = new Map<string, string[]>();
  let currentFile: string | null = null;

  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6);
      if (!fileDiffsMap.has(currentFile)) {
        fileDiffsMap.set(currentFile, []);
      }
    } else if (
      currentFile &&
      (line.startsWith('@@') ||
        line.startsWith('+') ||
        line.startsWith('-') ||
        line.startsWith(' '))
    ) {
      fileDiffsMap.get(currentFile)!.push(line);
    }
  }

  const files = Array.from(fileDiffsMap.keys());
  const fileDiffs: FileDiff[] = files.map((path) => ({
    path,
    hunks: fileDiffsMap.get(path)!.join('\n'),
  }));

  const listed = files.slice(0, 5).join(', ');
  const extra = files.length > 5 ? ` and ${files.length - 5} more` : '';
  const summary = `changes in ${listed}${extra}`;

  return { files, fileDiffs, summary };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd day32 && npx vitest run tests/review/diff-parser.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd day32 && git add src/review/diff-parser.ts tests/review/diff-parser.test.ts
git commit -m "feat(review): add diff-parser module"
```

---

## Task 2: `src/review/prompt-builder.ts`

**Files:**
- Create: `src/review/prompt-builder.ts`
- Test: `tests/review/prompt-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/review/prompt-builder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildReviewPrompt } from '../../src/review/prompt-builder.js';
import type { FileDiff } from '../../src/review/diff-parser.js';
import type { SearchResult } from '../../src/rag/types.js';

const makeRagResult = (text: string): SearchResult => ({
  chunk: {
    chunk_id: 'c1',
    source: '/docs/arch.md',
    file: 'arch.md',
    title: 'Architecture',
    section: 'Overview',
    strategy: 'structural',
    text,
    embedding: [],
  },
  score: 0.9,
});

describe('buildReviewPrompt', () => {
  const fileDiffs: FileDiff[] = [
    { path: 'src/foo.ts', hunks: '@@ -1 +1 @@\n-old\n+new' },
  ];

  it('includes file path in user prompt', () => {
    const { userPrompt } = buildReviewPrompt(fileDiffs, new Map(), []);
    expect(userPrompt).toContain('src/foo.ts');
  });

  it('includes RAG context in system prompt', () => {
    const { systemPrompt } = buildReviewPrompt(
      fileDiffs,
      new Map(),
      [makeRagResult('important architecture rule')],
    );
    expect(systemPrompt).toContain('important architecture rule');
  });

  it('includes file contents when provided', () => {
    const contents = new Map([['src/foo.ts', 'export function foo() {}']]);
    const { userPrompt } = buildReviewPrompt(fileDiffs, contents, []);
    expect(userPrompt).toContain('export function foo()');
  });

  it('truncates file contents longer than 2000 chars', () => {
    const longContent = 'x'.repeat(3000);
    const contents = new Map([['src/foo.ts', longContent]]);
    const { userPrompt } = buildReviewPrompt(fileDiffs, contents, []);
    expect(userPrompt).toContain('(truncated)');
    expect(userPrompt.length).toBeLessThan(longContent.length + 500);
  });

  it('system prompt instructs LLM to return JSON', () => {
    const { systemPrompt } = buildReviewPrompt(fileDiffs, new Map(), []);
    expect(systemPrompt).toContain('bugs');
    expect(systemPrompt).toContain('architectural_issues');
    expect(systemPrompt).toContain('recommendations');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd day32 && npx vitest run tests/review/prompt-builder.test.ts
```

Expected: FAIL — `Cannot find module '../../src/review/prompt-builder.js'`

- [ ] **Step 3: Write implementation**

Create `src/review/prompt-builder.ts`:

```ts
import type { SearchResult } from '../rag/types.js';
import type { FileDiff } from './diff-parser.js';

const MAX_FILE_CHARS = 2000;

export interface PromptParts {
  systemPrompt: string;
  userPrompt: string;
}

export function buildReviewPrompt(
  fileDiffs: FileDiff[],
  fileContents: Map<string, string>,
  ragResults: SearchResult[],
): PromptParts {
  const ragContext =
    ragResults.length > 0
      ? ragResults.map((r) => r.chunk.text).join('\n---\n')
      : 'No documentation context available.';

  const fileSection = fileDiffs
    .map(({ path }) => {
      const content = fileContents.get(path) ?? '(file not readable)';
      const truncated =
        content.length > MAX_FILE_CHARS
          ? content.slice(0, MAX_FILE_CHARS) + '\n... (truncated)'
          : content;
      return `### ${path}\n\`\`\`\n${truncated}\n\`\`\``;
    })
    .join('\n\n');

  const diffSection = fileDiffs
    .map(({ path, hunks }) => `### ${path}\n\`\`\`diff\n${hunks}\n\`\`\``)
    .join('\n\n');

  const systemPrompt =
    `You are an expert code reviewer. Analyze the provided git diff and return a JSON object with exactly these keys:\n` +
    `- "bugs": array of strings describing potential bugs or runtime errors\n` +
    `- "architectural_issues": array of strings describing design or architecture problems\n` +
    `- "recommendations": array of strings with improvement suggestions\n\n` +
    `Return ONLY valid JSON, no markdown fences, no extra text.\n\n` +
    `Project documentation context:\n${ragContext}`;

  const userPrompt =
    `Review this pull request.\n\n` +
    `## Changed Files (full content)\n${fileSection}\n\n` +
    `## Diff\n${diffSection}`;

  return { systemPrompt, userPrompt };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd day32 && npx vitest run tests/review/prompt-builder.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd day32 && git add src/review/prompt-builder.ts tests/review/prompt-builder.test.ts
git commit -m "feat(review): add prompt-builder module"
```

---

## Task 3: `src/review/CodeReviewer.ts`

**Files:**
- Create: `src/review/CodeReviewer.ts`

No unit test here — it requires real API + filesystem. Tested manually in Task 5.

- [ ] **Step 1: Write implementation**

Create `src/review/CodeReviewer.ts`:

```ts
import { readFile } from 'fs/promises';
import { join } from 'path';
import { parseDiff } from './diff-parser.js';
import { buildReviewPrompt } from './prompt-builder.js';
import { sendMessage } from '../api/openrouter.js';
import type { RagManager } from '../rag/RagManager.js';
import type { SearchResult } from '../rag/types.js';

export interface ReviewResult {
  bugs: string[];
  architectural_issues: string[];
  recommendations: string[];
}

export class CodeReviewer {
  constructor(
    private readonly ragManager: RagManager,
    private readonly model: string,
  ) {}

  async review(diff: string, repoPath: string): Promise<ReviewResult> {
    const parsed = parseDiff(diff);

    if (parsed.files.length === 0) {
      return { bugs: [], architectural_issues: [], recommendations: ['No changes detected.'] };
    }

    const fileContents = new Map<string, string>();
    for (const filePath of parsed.files) {
      try {
        const content = await readFile(join(repoPath, filePath), 'utf-8');
        fileContents.set(filePath, content);
      } catch {
        fileContents.set(filePath, '(could not read file)');
      }
    }

    let ragResults: SearchResult[] = [];
    try {
      ragResults = await this.ragManager.search(parsed.summary, 'structural', 6);
    } catch (err) {
      console.warn(
        '[CodeReviewer] RAG search failed, proceeding without context:',
        err instanceof Error ? err.message : err,
      );
    }

    const { systemPrompt, userPrompt } = buildReviewPrompt(
      parsed.fileDiffs,
      fileContents,
      ragResults,
    );

    const response = await sendMessage(
      [{ role: 'user', content: userPrompt }],
      this.model,
      systemPrompt,
    );

    return this.parseReviewResult(response.content);
  }

  private parseReviewResult(raw: string): ReviewResult {
    try {
      const cleaned = raw
        .replace(/^```(?:json)?\n?/m, '')
        .replace(/\n?```$/m, '')
        .trim();
      const parsed = JSON.parse(cleaned) as ReviewResult;
      return {
        bugs: Array.isArray(parsed.bugs) ? parsed.bugs : [],
        architectural_issues: Array.isArray(parsed.architectural_issues)
          ? parsed.architectural_issues
          : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      };
    } catch {
      return {
        bugs: [],
        architectural_issues: [],
        recommendations: [raw],
      };
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd day32 && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd day32 && git add src/review/CodeReviewer.ts
git commit -m "feat(review): add CodeReviewer class"
```

---

## Task 4: `src/review-cli.ts`

**Files:**
- Create: `src/review-cli.ts`

- [ ] **Step 1: Write implementation**

Create `src/review-cli.ts`:

```ts
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { config } from 'dotenv';
import { RagManager } from './rag/RagManager.js';
import { CodeReviewer } from './review/CodeReviewer.js';
import type { ReviewResult } from './review/CodeReviewer.js';

config();

function parseArgs(): { diffPath: string; repoPath: string } {
  const args = process.argv.slice(2);
  let diffPath = '';
  let repoPath = '.';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--diff' && args[i + 1]) diffPath = args[++i];
    if (args[i] === '--repo' && args[i + 1]) repoPath = args[++i];
  }

  if (!diffPath) {
    console.error('Error: --diff <path> is required');
    process.exit(1);
  }

  return { diffPath, repoPath };
}

function formatReview(result: ReviewResult): string {
  const lines: string[] = ['# Code Review\n'];

  lines.push('## 🐛 Potential Bugs');
  if (result.bugs.length === 0) {
    lines.push('No potential bugs found.\n');
  } else {
    result.bugs.forEach((b) => lines.push(`- ${b}`));
    lines.push('');
  }

  lines.push('## 🏗️ Architectural Issues');
  if (result.architectural_issues.length === 0) {
    lines.push('No architectural issues found.\n');
  } else {
    result.architectural_issues.forEach((a) => lines.push(`- ${a}`));
    lines.push('');
  }

  lines.push('## 💡 Recommendations');
  if (result.recommendations.length === 0) {
    lines.push('No recommendations.\n');
  } else {
    result.recommendations.forEach((r) => lines.push(`- ${r}`));
    lines.push('');
  }

  lines.push('---');
  lines.push('*Generated by AI Code Review Bot*');

  return lines.join('\n');
}

async function postGithubComment(body: string): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const prNumber = process.env.PR_NUMBER;
  const repo = process.env.GITHUB_REPOSITORY;

  if (!token || !prNumber || !repo) return;

  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.warn(`[review-cli] Failed to post GitHub comment: ${response.status} ${text}`);
  } else {
    console.log('[review-cli] Posted review comment to PR');
  }
}

async function main(): Promise<void> {
  const { diffPath, repoPath } = parseArgs();

  const diff = await readFile(resolve(diffPath), 'utf-8');

  if (!diff.trim()) {
    console.log('No changes detected, skipping review.');
    process.exit(0);
  }

  const ragManager = new RagManager({
    sourcePath: resolve(repoPath, 'for_rag/project-docs'),
    outputPath: resolve(repoPath, 'rag-data'),
    embeddingModel: 'nomic-embed-text',
    ollamaUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
    topK: 6,
    chunkSize: 500,
    chunkOverlap: 100,
  });

  const model = process.env.REVIEW_MODEL ?? 'openai/gpt-4o-mini';
  const reviewer = new CodeReviewer(ragManager, model);

  console.log('[review-cli] Running code review...');
  const result = await reviewer.review(diff, resolve(repoPath));

  const markdown = formatReview(result);
  console.log('\n' + markdown);

  await postGithubComment(markdown);
}

main().catch((err) => {
  console.error('[review-cli] Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd day32 && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Build and smoke test locally**

```bash
cd day32 && npm run build
```

Expected: `dist/review-cli.js` is created

Then create a test diff and run:

```bash
cd day32 && git diff HEAD~1 > /tmp/test.patch
node dist/review-cli.js --diff /tmp/test.patch --repo .
```

Expected: review output printed to stdout (may warn about RAG index if Ollama not running)

- [ ] **Step 4: Commit**

```bash
cd day32 && git add src/review-cli.ts
git commit -m "feat(review): add review-cli entry point"
```

---

## Task 5: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/code-review.yml` (at repo root, not inside day32)

- [ ] **Step 1: Create workflows directory and file**

```bash
mkdir -p /path/to/repo/.github/workflows
```

Create `.github/workflows/code-review.yml` at the **repository root** (not inside day32/):

```yaml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: day32/package-lock.json

      - name: Install dependencies
        working-directory: day32
        run: npm ci

      - name: Build
        working-directory: day32
        run: npm run build

      - name: Generate diff
        working-directory: day32
        run: git diff origin/${{ github.base_ref }}...HEAD > diff.patch

      - name: Run AI code review
        working-directory: day32
        run: node dist/review-cli.js --diff diff.patch --repo .
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          GITHUB_REPOSITORY: ${{ github.repository }}
          REVIEW_MODEL: openai/gpt-4o-mini
```

- [ ] **Step 2: Add OPENROUTER_API_KEY to GitHub repo secrets**

Go to: `Repository → Settings → Secrets and variables → Actions → New repository secret`
- Name: `OPENROUTER_API_KEY`
- Value: your key from `.env`

`GITHUB_TOKEN` is provided automatically by GitHub Actions — no need to add it manually.

- [ ] **Step 3: Commit the workflow**

```bash
git add .github/workflows/code-review.yml
git commit -m "feat(ci): add AI code review GitHub Actions workflow"
```

- [ ] **Step 4: Test by opening a PR**

Push a branch with some changes and open a PR. The Action should:
1. Appear in the PR's "Checks" tab
2. Post a review comment with bugs/architectural issues/recommendations

---

## Task 6: Run all unit tests

- [ ] **Step 1: Run all tests**

```bash
cd day32 && npm test
```

Expected: all tests pass, including the new `diff-parser` and `prompt-builder` tests

- [ ] **Step 2: Final commit if any fixes needed**

```bash
cd day32 && git add -A
git commit -m "test(review): ensure all tests pass"
```
