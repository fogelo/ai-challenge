import { describe, it, expect } from 'vitest';
import { filterByThreshold, DEFAULT_FILTER_OPTIONS } from './reranker.js';
import type { SearchResult } from './types.js';

function makeResult(score: number): SearchResult {
  return {
    score,
    chunk: {
      chunk_id: `id_${score}`,
      source: '/fake/path.md',
      file: 'path.md',
      title: 'Test',
      section: '',
      strategy: 'structural',
      text: `chunk score ${score}`,
      embedding: [],
    },
  };
}

describe('filterByThreshold', () => {
  it('keeps results at or above threshold', () => {
    const results = [makeResult(0.8), makeResult(0.5), makeResult(0.3)];
    const filtered = filterByThreshold(results, 0.5);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].score).toBe(0.8);
    expect(filtered[1].score).toBe(0.5);
  });

  it('returns top-1 fallback when all filtered out', () => {
    const results = [makeResult(0.8), makeResult(0.7)];
    const filtered = filterByThreshold(results, 0.9);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].score).toBe(0.8);
  });

  it('returns empty array when input is empty', () => {
    const filtered = filterByThreshold([], 0.5);
    expect(filtered).toHaveLength(0);
  });

  it('DEFAULT_FILTER_OPTIONS has expected values', () => {
    expect(DEFAULT_FILTER_OPTIONS.threshold).toBe(0.5);
    expect(DEFAULT_FILTER_OPTIONS.topKInitial).toBe(10);
    expect(DEFAULT_FILTER_OPTIONS.topKFinal).toBe(5);
  });
});
