import { describe, it, expect, vi } from 'vitest';
import { Embedder } from '../../src/rag/embedder.js';

describe('Embedder', () => {
  it('возвращает массив чисел для текста', async () => {
    // Мокаем fetch чтобы не требовать реальный Ollama
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    } as Response);

    const embedder = new Embedder('http://localhost:11434', 'nomic-embed-text');
    const vector = await embedder.embed('тестовый текст');

    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBeGreaterThan(0);
    expect(typeof vector[0]).toBe('number');
  });

  it('бросает ошибку при недоступном Ollama', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const embedder = new Embedder('http://localhost:11434', 'nomic-embed-text');
    await expect(embedder.embed('текст')).rejects.toThrow('Ollama недоступен');
  });
});
