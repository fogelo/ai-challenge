// src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'day16-local-server',
  version: '1.0.0',
});

server.registerTool(
  'get_time',
  {
    description: 'Возвращает текущее дату и время',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text: new Date().toLocaleString('ru-RU') }],
  })
);

server.registerTool(
  'echo',
  {
    description: 'Повторяет переданное сообщение',
    inputSchema: { message: z.string().describe('Текст для повтора') },
  },
  async ({ message }) => ({
    content: [{ type: 'text', text: message }],
  })
);

server.registerTool(
  'get_agent_info',
  {
    description: 'Возвращает информацию о CLI агенте',
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          name: 'AI Agent CLI',
          version: '1.0.0',
          platform: process.platform,
          nodeVersion: process.version,
        }),
      },
    ],
  })
);

const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();
