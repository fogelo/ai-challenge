import { Message, OpenRouterRequest, OpenRouterResponse, ApiResponse, ToolCall } from '../types/index.js';
import type { MCPTool } from '../mcp/index.js';

interface OpenRouterTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export async function sendMessage(
  messages: Message[],
  modelId: string,
  systemPrompt?: string,
  temperature?: number,
  tools?: MCPTool[]
): Promise<ApiResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY не найден в переменных окружения');
  }

  if (!modelId) {
    throw new Error('Model ID is required');
  }

  const allMessages = (systemPrompt
    ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
    : messages
  ).map((m) => {
    const msg: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    return msg;
  });

  const openRouterTools: OpenRouterTool[] | undefined =
    tools && tools.length > 0
      ? tools.map((tool) => {
          // inputSchema из MCP SDK уже является корректным JSON Schema объектом
          // (с полями type, properties и т.д.) — используем его напрямую
          const schema = tool.inputSchema;
          const isJsonSchema = schema && typeof schema === 'object' && 'type' in schema;
          return {
            type: 'function' as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: isJsonSchema
                ? schema as Record<string, unknown>
                : { type: 'object', properties: {} },
            },
          };
        })
      : undefined;

  const requestBody: OpenRouterRequest = {
    model: modelId,
    messages: allMessages as unknown as Message[],
    ...(temperature !== undefined && { temperature }),
    ...(openRouterTools && { tools: openRouterTools, tool_choice: 'auto' }),
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

    const choice = data.choices[0];
    const rawToolCalls = choice.message.tool_calls;
    const finishReason = choice.finish_reason;

    // Заполняем toolCalls когда LLM сигнализирует о желании вызвать инструменты
    const toolCalls: ToolCall[] | undefined =
      (finishReason === 'tool_calls' || (rawToolCalls && rawToolCalls.length > 0))
        ? rawToolCalls?.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: (() => {
              try {
                return JSON.parse(tc.function.arguments) as Record<string, unknown>;
              } catch {
                return {};
              }
            })(),
          }))
        : undefined;

    return {
      content: choice.message.content ?? '',
      usage: data.usage,
      responseTime,
      toolCalls,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Ошибка при обращении к OpenRouter: ${error.message}`);
    }
    throw error;
  }
}
