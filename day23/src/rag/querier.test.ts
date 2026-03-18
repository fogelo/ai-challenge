import { describe, it, expect, vi } from 'vitest';
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
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
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
