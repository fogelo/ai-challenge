import { describe, it, expect } from 'vitest';
import { buildRagSystemPrompt } from '../../src/rag/querier.js';
import type { SearchResult } from '../../src/rag/types.js';

const makeResult = (text: string, title: string, section: string, score: number): SearchResult => ({
  chunk: {
    chunk_id: 'id',
    source: '/src.md',
    file: 'src.md',
    title,
    section,
    strategy: 'structural',
    text,
    embedding: [],
  },
  score,
});

describe('buildRagSystemPrompt', () => {
  it('включает текст каждого чанка в промпт', () => {
    const results = [makeResult('Текст первого чанка', 'Book A', 'Глава 1', 0.9)];
    const prompt = buildRagSystemPrompt(results);
    expect(prompt).toContain('Текст первого чанка');
  });

  it('разделяет чанки через ---', () => {
    const results = [
      makeResult('Чанк 1', 'Book A', '', 0.9),
      makeResult('Чанк 2', 'Book B', '', 0.8),
    ];
    const prompt = buildRagSystemPrompt(results);
    expect(prompt).toContain('---');
  });

  it('содержит инструкцию отвечать только по контексту', () => {
    const prompt = buildRagSystemPrompt([]);
    expect(prompt.toLowerCase()).toContain('контекст');
  });
});

import { loadControlQuestions } from '../../src/rag/querier.js';
import type { ControlQuestion } from '../../src/rag/querier.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

describe('loadControlQuestions', () => {
  it('читает и парсит JSON файл с вопросами', async () => {
    const tmpFile = path.join(os.tmpdir(), 'test-questions.json');
    const questions: ControlQuestion[] = [
      {
        question: 'Что такое RAG?',
        expectedAnswer: 'Retrieval Augmented Generation',
        expectedSources: ['Book A'],
      },
    ];
    await fs.writeFile(tmpFile, JSON.stringify(questions), 'utf-8');

    const loaded = await loadControlQuestions(tmpFile);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].question).toBe('Что такое RAG?');

    await fs.unlink(tmpFile);
  });

  it('выбрасывает ошибку если файл не найден', async () => {
    await expect(loadControlQuestions('/nonexistent/path.json')).rejects.toThrow();
  });
});
