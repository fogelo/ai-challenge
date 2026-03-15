// src/mcp/server-ai.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'server-ai', version: '1.0.0' });

server.registerTool(
  'summarize',
  {
    description: 'Суммаризирует переданный текст с помощью LLM в 3-5 предложениях. Используй как второй шаг пайплайна после search.',
    inputSchema: {
      text: z.string().describe('Текст для суммаризации'),
      instructions: z.string().optional().describe('Дополнительные инструкции (например: "на русском языке", "фокус на технических деталях")'),
    },
  },
  async ({ text, instructions }) => {
    try {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return { content: [{ type: 'text', text: '❌ OPENROUTER_API_KEY не найден' }] };
      }
      if (!text.trim()) {
        return { content: [{ type: 'text', text: '❌ Текст для суммаризации не может быть пустым' }] };
      }
      const userPrompt = instructions ? `${instructions}\n\nТекст:\n${text}` : `Текст:\n${text}`;
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Ты помощник для суммаризации текста. Создай краткое резюме в 3-5 предложениях.' },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
      if (!response.ok) {
        const err = await response.text();
        return { content: [{ type: 'text', text: `❌ OpenRouter ошибка (${response.status}): ${err}` }] };
      }
      const data = await response.json() as { choices: Array<{ message: { content: string } }> };
      const summary = data.choices?.[0]?.message?.content ?? '(пустой ответ)';
      return { content: [{ type: 'text', text: summary }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

const transport = new StdioServerTransport();
(async () => { await server.connect(transport); })();
