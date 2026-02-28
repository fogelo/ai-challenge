import type { AIConfig, OpenRouterRequest, OpenRouterResponse, Message } from '@/app/types/chat'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Отправить запрос к OpenRouter API
 */
export async function sendMessageToOpenRouter(
  userMessage: string,
  history: Message[],
  config: AIConfig
): Promise<string> {
  const messages = [
    ...history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
    {
      role: 'user' as const,
      content: userMessage,
    },
  ]

  const requestBody: OpenRouterRequest = {
    model: config.openrouter.model,
    messages,
    temperature: config.openrouter.temperature,
    max_tokens: config.openrouter.maxTokens,
  }

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openrouter.apiKey}`,
        'HTTP-Referer': 'https://github.com/your-repo', // Optional
        'X-Title': 'AI Agent MVP', // Optional
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`)
    }

    const data: OpenRouterResponse = await response.json()

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response from OpenRouter API')
    }

    const assistantMessage = data.choices[0].message.content

    if (!assistantMessage) {
      throw new Error('Empty response from OpenRouter API')
    }

    return assistantMessage
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`OpenRouter API call failed: ${error.message}`)
    }
    throw new Error('Unknown error during OpenRouter API call')
  }
}
