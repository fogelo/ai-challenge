import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockOpenRouterSend, mockOllamaSend } = vi.hoisted(() => ({
  mockOpenRouterSend: vi.fn(),
  mockOllamaSend: vi.fn(),
}));

vi.mock('./openrouter.js', () => ({ sendMessage: mockOpenRouterSend }));
vi.mock('./ollama.js', () => ({ sendMessage: mockOllamaSend }));

import { getSendMessage } from './index.js';

const fakeMessages = [{ role: 'user' as const, content: 'hi' }];

beforeEach(() => {
  mockOpenRouterSend.mockReset().mockResolvedValue({ content: 'from openrouter', responseTime: 0.1 });
  mockOllamaSend.mockReset().mockResolvedValue({ content: 'from ollama', responseTime: 0.1 });
});

describe('getSendMessage', () => {
  it('routes to OpenRouter when provider is openrouter', async () => {
    const fakeConfig = {
      getProviderConfig: () => ({
        provider: 'openrouter' as const,
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'llama3.2',
      }),
    };
    const send = getSendMessage(fakeConfig as any);
    const result = await send(fakeMessages, 'anthropic/claude-3.5-sonnet');
    expect(result.content).toBe('from openrouter');
    expect(mockOpenRouterSend).toHaveBeenCalledOnce();
    expect(mockOllamaSend).not.toHaveBeenCalled();
  });

  it('routes to Ollama when provider is ollama', async () => {
    const fakeConfig = {
      getProviderConfig: () => ({
        provider: 'ollama' as const,
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'gemma3',
      }),
      getOllamaParams: () => ({ maxTokens: undefined, numCtx: undefined }),
    };
    const send = getSendMessage(fakeConfig as any);
    const result = await send(fakeMessages, 'anthropic/claude-3.5-sonnet');
    expect(result.content).toBe('from ollama');
    expect(mockOllamaSend).toHaveBeenCalledOnce();
    expect(mockOpenRouterSend).not.toHaveBeenCalled();
  });

  it('passes ollamaBaseUrl and ollamaModel to Ollama client', async () => {
    const fakeConfig = {
      getProviderConfig: () => ({
        provider: 'ollama' as const,
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'llama3.2',
      }),
      getOllamaParams: () => ({ maxTokens: undefined, numCtx: undefined }),
    };
    const send = getSendMessage(fakeConfig as any);
    await send(fakeMessages, 'any-model', 'system prompt');
    expect(mockOllamaSend).toHaveBeenCalledWith(
      fakeMessages,
      'llama3.2',
      'http://localhost:11434',
      'system prompt',
      undefined,
      undefined,
      undefined,
      undefined
    );
  });

  it('passes maxTokens and numCtx from config to Ollama client', async () => {
    const fakeConfig = {
      getProviderConfig: () => ({
        provider: 'ollama' as const,
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'mistral',
      }),
      getOllamaParams: () => ({ maxTokens: 1024, numCtx: 8192 }),
    };
    const send = getSendMessage(fakeConfig as any);
    await send(fakeMessages, 'any-model');
    expect(mockOllamaSend).toHaveBeenCalledWith(
      fakeMessages,
      'mistral',
      'http://localhost:11434',
      undefined,
      undefined,
      undefined,
      1024,
      8192
    );
  });
});
