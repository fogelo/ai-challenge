import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ollama sendMessage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sends request to correct Ollama endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello from Ollama', role: 'assistant' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const { sendMessage } = await import('./ollama.js');
    const result = await sendMessage(
      [{ role: 'user', content: 'Hello' }],
      'llama3.2',
      'http://localhost:11434',
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.content).toBe('Hello from Ollama');
  });

  it('includes system prompt when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ok', role: 'assistant' }, finish_reason: 'stop' }],
      }),
    });

    const { sendMessage } = await import('./ollama.js');
    await sendMessage(
      [{ role: 'user', content: 'hi' }],
      'llama3.2',
      'http://localhost:11434',
      'You are helpful',
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are helpful' });
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'model not found',
    });

    const { sendMessage } = await import('./ollama.js');
    await expect(
      sendMessage([{ role: 'user', content: 'hi' }], 'bad-model', 'http://localhost:11434')
    ).rejects.toThrow('404');
  });

  it('includes max_tokens in request when maxTokens provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const { sendMessage } = await import('./ollama.js');
    await sendMessage(
      [{ role: 'user', content: 'hello' }],
      'mistral',
      'http://localhost:11434',
      undefined,
      undefined,
      undefined,
      512   // maxTokens
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(512);
  });

  it('includes options.num_ctx in request when numCtx provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    const { sendMessage } = await import('./ollama.js');
    await sendMessage(
      [{ role: 'user', content: 'hello' }],
      'mistral',
      'http://localhost:11434',
      undefined,
      undefined,
      undefined,
      undefined,
      8192  // numCtx
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.options?.num_ctx).toBe(8192);
  });
});
