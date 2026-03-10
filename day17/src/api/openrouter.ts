import { Message, OpenRouterRequest, OpenRouterResponse, ApiResponse } from '../types/index.js';

export async function sendMessage(
  messages: Message[],
  modelId: string,
  systemPrompt?: string,
  temperature?: number
): Promise<ApiResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY не найден в переменных окружения');
  }

  if (!modelId) {
    throw new Error('Model ID is required');
  }

  const allMessages: Message[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const requestBody: OpenRouterRequest = {
    model: modelId,
    messages: allMessages,
    ...(temperature !== undefined && { temperature }),
  };

  const startTime = performance.now();

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    const data: OpenRouterResponse = await response.json();
    const responseTime = (performance.now() - startTime) / 1000;

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Некорректный формат ответа от OpenRouter API');
    }

    return {
      content: data.choices[0].message.content ?? '',
      usage: data.usage,
      responseTime,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Ошибка при обращении к OpenRouter: ${error.message}`);
    }
    throw error;
  }
}
