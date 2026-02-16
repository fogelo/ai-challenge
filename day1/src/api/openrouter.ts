import { Message, OpenRouterRequest, OpenRouterResponse } from '../types/index.js';

export async function sendMessage(messages: Message[]): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY не найден в переменных окружения');
  }

  if (!model) {
    throw new Error('OPENROUTER_MODEL не найден в переменных окружения');
  }

  const requestBody: OpenRouterRequest = {
    model,
    messages,
  };

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

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Некорректный формат ответа от OpenRouter API');
    }

    return data.choices[0].message.content;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Ошибка при обращении к OpenRouter: ${error.message}`);
    }
    throw error;
  }
}
