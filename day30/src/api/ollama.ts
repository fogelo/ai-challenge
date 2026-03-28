import { Message, ApiResponse, ToolCall } from '../types/index.js';
import type { MCPTool } from '../mcp/index.js';

interface OllamaRequest {
  model: string;
  messages: unknown[];
  temperature?: number;
  max_tokens?: number;
  options?: { num_ctx?: number };
  tools?: unknown[];
  tool_choice?: 'auto';
}

interface OllamaResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function sendMessage(
  messages: Message[],
  modelId: string,
  baseUrl: string,
  systemPrompt?: string,
  temperature?: number,
  tools?: MCPTool[],
  maxTokens?: number,
  numCtx?: number
): Promise<ApiResponse> {
  const allMessages = (systemPrompt
    ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
    : messages
  ).map((m) => {
    const msg: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    return msg;
  });

  const ollamaTools = tools && tools.length > 0
    ? tools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema && typeof tool.inputSchema === 'object' && 'type' in tool.inputSchema
            ? tool.inputSchema as Record<string, unknown>
            : { type: 'object', properties: {} },
        },
      }))
    : undefined;

  const requestBody: OllamaRequest = {
    model: modelId,
    messages: allMessages,
    ...(temperature !== undefined && { temperature }),
    ...(maxTokens !== undefined && { max_tokens: maxTokens }),
    ...(numCtx !== undefined && { options: { num_ctx: numCtx } }),
    ...(ollamaTools && { tools: ollamaTools, tool_choice: 'auto' }),
  };

  const startTime = performance.now();

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
  }

  const data: OllamaResponse = await response.json();
  const responseTime = (performance.now() - startTime) / 1000;

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Некорректный формат ответа от Ollama');
  }

  const choice = data.choices[0];
  const rawToolCalls = choice.message.tool_calls;
  const finishReason = choice.finish_reason;

  const toolCalls: ToolCall[] | undefined =
    (finishReason === 'tool_calls' || (rawToolCalls && rawToolCalls.length > 0))
      ? rawToolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: (() => {
            try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; }
            catch { return {}; }
          })(),
        }))
      : undefined;

  return {
    content: choice.message.content ?? '',
    usage: data.usage,
    responseTime,
    toolCalls,
  };
}
