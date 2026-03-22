import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rewriteQuery } from './querier.js';

vi.mock('../api/openrouter.js', () => ({
  sendMessage: vi.fn(),
}));

import { sendMessage } from '../api/openrouter.js';
const mockSendMessage = vi.mocked(sendMessage);

describe('rewriteQuery', () => {
  it('returns rewritten query from LLM', async () => {
    mockSendMessage.mockResolvedValueOnce({
      content: 'что такое dependency injection',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, responseTime: 0.1,
    });

    const result = await rewriteQuery('что такое DI', 'test-model');
    expect(result).toBe('что такое dependency injection');
  });

  it('returns original question on LLM error', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('API error'));

    const result = await rewriteQuery('original question', 'test-model');
    expect(result).toBe('original question');
  });
});

import { ragQueryEnhanced } from './querier.js';
import { DEFAULT_FILTER_OPTIONS } from './reranker.js';
import type { RagManager } from './RagManager.js';
import type { SearchResult } from './types.js';

import {
  Citation,
  SourceCited,
  RagAnswerCited,
  LOW_CONFIDENCE_THRESHOLD,
  buildRagSystemPromptWithCitations,
  ragQueryCited,
} from './querier.js';

describe('Citation types and LOW_CONFIDENCE_THRESHOLD', () => {
  it('LOW_CONFIDENCE_THRESHOLD is 0.65', () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.65);
  });

  it('Citation shape is correct', () => {
    const c: Citation = {
      chunk_id: 'doc_0',
      file: 'arch.md',
      section: 'Intro',
      excerpt: 'Some text...',
    };
    expect(c.chunk_id).toBe('doc_0');
    expect(c.file).toBe('arch.md');
    expect(c.excerpt).toBe('Some text...');
  });
});

function makeSearchResult(score: number): SearchResult {
  return {
    score,
    chunk: {
      chunk_id: `id_${score}`,
      source: '/fake/path.md',
      file: 'path.md',
      title: 'Test',
      section: 'S',
      strategy: 'structural',
      text: `text ${score}`,
      embedding: [],
    },
  };
}

describe('buildRagSystemPromptWithCitations', () => {
  it('includes [ID: chunk_id] markers for each chunk', () => {
    const results: SearchResult[] = [
      {
        score: 0.9,
        chunk: {
          chunk_id: 'arch_0',
          source: '/abs/path.md',
          file: 'arch.md',
          title: 'Architecture',
          section: 'Intro',
          strategy: 'structural',
          text: 'Clean architecture is about dependencies.',
          embedding: [],
        },
      },
      {
        score: 0.8,
        chunk: {
          chunk_id: 'arch_1',
          source: '/abs/path.md',
          file: 'arch.md',
          title: 'Architecture',
          section: 'Layers',
          strategy: 'structural',
          text: 'The domain layer has no external deps.',
          embedding: [],
        },
      },
    ];

    const prompt = buildRagSystemPromptWithCitations(results);
    expect(prompt).toContain('[ID: arch_0]');
    expect(prompt).toContain('[ID: arch_1]');
    expect(prompt).toContain('Clean architecture is about dependencies.');
    expect(prompt).toContain('The domain layer has no external deps.');
  });

  it('returns empty context block for empty results', () => {
    const prompt = buildRagSystemPromptWithCitations([]);
    expect(prompt).toContain('Контекст:');
    expect(prompt).not.toContain('[ID:');
  });
});

describe('ragQueryCited', () => {
  beforeEach(() => mockSendMessage.mockClear());

  it('returns isLowConfidence=true when results are empty', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([]),
    } as unknown as RagManager;

    const result = await ragQueryCited('question', mockRagManager, 'test-model');

    expect(result.isLowConfidence).toBe(true);
    expect(result.citations).toHaveLength(0);
    expect(result.sources).toHaveLength(0);
    expect(result.answer).toContain('уточните');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns isLowConfidence=true when max score is below LOW_CONFIDENCE_THRESHOLD', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([
        makeSearchResult(0.2),
        makeSearchResult(0.15),
      ]),
    } as unknown as RagManager;

    const result = await ragQueryCited('question', mockRagManager, 'test-model');

    expect(result.isLowConfidence).toBe(true);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns citations and sources when results are above threshold', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([
        makeSearchResult(0.9),
        makeSearchResult(0.8),
        makeSearchResult(0.2), // below filter threshold (0.5) — will be removed
      ]),
    } as unknown as RagManager;

    mockSendMessage.mockResolvedValueOnce({
      content: 'The answer is here.',
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      responseTime: 0.2,
    });

    const result = await ragQueryCited('test question', mockRagManager, 'test-model');

    expect(result.isLowConfidence).toBe(false);
    expect(result.answer).toBe('The answer is here.');
    expect(result.citations).toHaveLength(2);
    expect(result.sources).toHaveLength(2);
    expect(result.citations[0].chunk_id).toBe('id_0.9');
    expect(result.citations[0].file).toBe('path.md');
    expect(result.citations[0].excerpt).toContain('text 0.9');
    expect(result.sources[0].file).toBe('path.md');
    expect(result.sources[0].chunk_id).toBe('id_0.9');
  });

  it('respects custom lowConfidenceThreshold option', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([makeSearchResult(0.35)]),
    } as unknown as RagManager;

    const result = await ragQueryCited('question', mockRagManager, 'test-model', {
      lowConfidenceThreshold: 0.4,
    });

    expect(result.isLowConfidence).toBe(true);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe('ragQueryEnhanced', () => {
  it('returns RagAnswerEnhanced with filter stats', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([
        makeSearchResult(0.9),
        makeSearchResult(0.8),
        makeSearchResult(0.3),
      ]),
    } as unknown as RagManager;

    mockSendMessage.mockResolvedValueOnce({
      content: 'rewritten query',
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }, responseTime: 0.1,
    });
    mockSendMessage.mockResolvedValueOnce({
      content: 'final answer',
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }, responseTime: 0.2,
    });

    const result = await ragQueryEnhanced(
      'test question',
      mockRagManager,
      'test-model',
      { withFilter: true, withRewrite: true, ...DEFAULT_FILTER_OPTIONS },
    );

    expect(result.answer).toBe('final answer');
    expect(result.rewrittenQuery).toBe('rewritten query');
    expect(result.chunksBeforeFilter).toBe(3);
    expect(result.chunksAfterFilter).toBe(2);
  });

  it('skips rewrite when withRewrite is false', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([makeSearchResult(0.8)]),
    } as unknown as RagManager;

    mockSendMessage.mockResolvedValueOnce({
      content: 'answer',
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, responseTime: 0.1,
    });

    const result = await ragQueryEnhanced(
      'question',
      mockRagManager,
      'test-model',
      { withFilter: false, withRewrite: false },
    );

    expect(result.rewrittenQuery).toBeUndefined();
    expect(result.chunksBeforeFilter).toBe(1);
    expect(result.chunksAfterFilter).toBe(1);
  });
});

import { ragQueryWithHistory } from './querier.js';
import type { Message } from '../types/index.js';

describe('ragQueryWithHistory', () => {
  beforeEach(() => mockSendMessage.mockClear());

  it('passes full message history to sendMessage', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([makeSearchResult(0.9)]),
    } as unknown as RagManager;

    mockSendMessage.mockResolvedValueOnce({
      content: 'answer with history',
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      responseTime: 0.2,
    });

    const history: Message[] = [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'follow-up question' },
    ];

    const result = await ragQueryWithHistory(
      'follow-up question',
      history,
      'Task: answer about architecture',
      mockRagManager,
      'test-model',
    );

    expect(result.isLowConfidence).toBe(false);
    expect(result.answer).toBe('answer with history');
    expect(result.sources).toHaveLength(1);
    expect(result.citations).toHaveLength(1);

    // sendMessage must receive the full history (3 messages), not just the current question
    const callArgs = mockSendMessage.mock.calls[0];
    expect(callArgs[0]).toHaveLength(3);
    expect(callArgs[0][0].content).toBe('first question');
  });

  it('returns isLowConfidence when max score is below threshold', async () => {
    const mockRagManager = {
      search: vi.fn().mockResolvedValue([makeSearchResult(0.2)]),
    } as unknown as RagManager;

    const history: Message[] = [{ role: 'user', content: 'question' }];

    const result = await ragQueryWithHistory(
      'question',
      history,
      '',
      mockRagManager,
      'test-model',
    );

    expect(result.isLowConfidence).toBe(true);
    expect(result.answer).toContain('уточните вопрос');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
