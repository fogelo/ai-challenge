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
