import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RagManager } from '../../src/rag/RagManager.js';

// Мокаем indexer и embedder чтобы не требовать реальный Ollama и файловую систему
vi.mock('../../src/rag/indexer.js', () => ({
  buildIndex: vi.fn().mockResolvedValue({
    meta: { created_at: '', model: 'nomic-embed-text', strategy: 'fixed', total_chunks: 1 },
    chunks: [
      {
        chunk_id: 'test_0',
        source: '/test.md',
        file: 'test.md',
        title: 'Test',
        section: '',
        strategy: 'fixed',
        text: 'микроядерная архитектура',
        embedding: [1, 0, 0],
      },
    ],
  }),
  saveIndex: vi.fn().mockResolvedValue(undefined),
  loadIndex: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/rag/embedder.js', () => ({
  Embedder: vi.fn().mockImplementation(function () {
    return { embed: vi.fn().mockResolvedValue([1, 0, 0]) };
  }),
}));

describe('RagManager', () => {
  let manager: RagManager;

  beforeEach(() => {
    vi.clearAllMocks(); // сбрасываем счётчики вызовов между тестами
    manager = new RagManager({
      sourcePath: 'for_rag/Архитектура',
      outputPath: 'rag-data',
      embeddingModel: 'nomic-embed-text',
      ollamaUrl: 'http://localhost:11434',
      topK: 3,
      chunkSize: 500,
      chunkOverlap: 100,
    });
  });

  it('index() вызывает buildIndex для обеих стратегий', async () => {
    const { buildIndex, saveIndex } = await import('../../src/rag/indexer.js');
    await manager.index();
    expect(buildIndex).toHaveBeenCalledWith('fixed', expect.any(Object));
    expect(buildIndex).toHaveBeenCalledWith('structural', expect.any(Object));
    expect(saveIndex).toHaveBeenCalledTimes(2);
  });

  it('search() возвращает массив SearchResult', async () => {
    await manager.index();
    const results = await manager.search('микроядро', 'fixed');
    expect(Array.isArray(results)).toBe(true);
  });

  it('compare() возвращает результаты для обеих стратегий', async () => {
    await manager.index();
    const result = await manager.compare('микроядро');
    expect(result).toHaveProperty('fixed');
    expect(result).toHaveProperty('structural');
  });
});
