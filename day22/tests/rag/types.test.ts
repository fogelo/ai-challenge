import { describe, it, expect } from 'vitest';
import type { Chunk, IndexFile, SearchResult, RagConfig } from '../../src/rag/types.js';

describe('RAG types', () => {
  it('Chunk should have required fields', () => {
    const chunk: Chunk = {
      chunk_id: 'path/to/file_0',
      source: '/absolute/path/to/file.md',
      file: 'file.md',
      title: 'Head First. Архитектура ПО',
      section: 'Микроядерная архитектура',
      strategy: 'fixed',
      text: 'Some text content',
      embedding: [0.1, 0.2, 0.3],
    };
    expect(chunk.chunk_id).toBe('path/to/file_0');
    expect(chunk.strategy).toBe('fixed');
  });

  it('RagConfig should have required fields', () => {
    const config: RagConfig = {
      sourcePath: 'for_rag/Архитектура',
      outputPath: 'rag-data',
      embeddingModel: 'nomic-embed-text',
      ollamaUrl: 'http://localhost:11434',
      topK: 3,
      chunkSize: 500,
      chunkOverlap: 100,
    };
    expect(config.topK).toBe(3);
  });
});
