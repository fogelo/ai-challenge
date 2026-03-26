import { sendMessage as sendMessageOpenRouter } from './openrouter.js';
import { sendMessage as sendMessageOllama } from './ollama.js';
import type { ConfigManager } from '../models/config.js';
import type { Message, ApiResponse } from '../types/index.js';
import type { MCPTool } from '../mcp/index.js';

export function getSendMessage(configManager: Pick<ConfigManager, 'getProviderConfig' | 'getOllamaParams'>) {
  return async (
    messages: Message[],
    modelId: string,
    systemPrompt?: string,
    temperature?: number,
    tools?: MCPTool[]
  ): Promise<ApiResponse> => {
    const { provider, ollamaBaseUrl, ollamaModel } = configManager.getProviderConfig();

    if (provider === 'ollama') {
      const { maxTokens, numCtx } = configManager.getOllamaParams();
      return sendMessageOllama(messages, ollamaModel, ollamaBaseUrl, systemPrompt, temperature, tools, maxTokens, numCtx);
    }

    return sendMessageOpenRouter(messages, modelId, systemPrompt, temperature, tools);
  };
}
