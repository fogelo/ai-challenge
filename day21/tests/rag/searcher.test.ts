import { describe, it, expect } from 'vitest';
import { cosineSimilarity, search } from '../../src/rag/searcher.js';
import type { Chunk } from '../../src/rag/types.js';

describe('cosineSimilarity', () => {
  it('возвращает 1 для одинаковых векторов', () => {
    const v = [1, 0, 0];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it('возвращает 0 для ортогональных векторов', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('возвращает значение от 0 до 1 для похожих векторов', () => {
    const score = cosineSimilarity([1, 2, 3], [1, 2, 4]);
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('search', () => {
  const makeChunk = (text: string, embedding: number[]): Chunk => ({
    chunk_id: text,
    source: '/test.md',
    file: 'test.md',
    title: 'Test',
    section: '',
    strategy: 'fixed',
    text,
    embedding,
  });

  it('возвращает топ-K результатов отсортированных по score', () => {
    const chunks = [
      makeChunk('чанк А', [1, 0, 0]),
      makeChunk('чанк Б', [0, 1, 0]),
      makeChunk('чанк В', [0.9, 0.1, 0]),
    ];
    const query = [1, 0, 0];
    const results = search(query, chunks, 2);

    expect(results.length).toBe(2);
    expect(results[0].chunk.text).toBe('чанк А');
    expect(results[0].score).toBeCloseTo(1);
    expect(results[1].chunk.text).toBe('чанк В');
  });

  it('возвращает меньше K если чанков меньше', () => {
    const chunks = [makeChunk('один', [1, 0])];
    const results = search([1, 0], chunks, 5);
    expect(results.length).toBe(1);
  });
});
