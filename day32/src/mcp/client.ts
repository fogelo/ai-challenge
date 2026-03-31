// src/mcp/client.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
}

interface ServerConfig {
  name: string;
  file: string;
}

interface ServerConnection {
  config: ServerConfig;
  client: Client;
  transport: StdioClientTransport;
}

export class MCPClientManager {
  private connections = new Map<string, ServerConnection>();
  private toolServerMap = new Map<string, string>(); // tool name → server name

  private static readonly SERVERS: ServerConfig[] = [
    { name: 'server-web',   file: 'server-web.js' },
    { name: 'server-ai',    file: 'server-ai.js' },
    { name: 'server-files', file: 'server-files.js' },
    { name: 'server-utils', file: 'server-utils.js' },
    { name: 'server-git',   file: 'server-git.js' },
  ];

  // Инструменты, скрытые от LLM (используются только внутренним кодом)
  private static readonly INTERNAL_TOOLS = new Set(['check_fired_reminders']);

  isConnected(): boolean {
    return this.connections.size > 0;
  }

  async connect(): Promise<void> {
    if (this.connections.size > 0) return;

    await Promise.all(
      MCPClientManager.SERVERS.map(async (config) => {
        const transport = new StdioClientTransport({
          command: 'node',
          args: [join(__dirname, config.file)],
          env: process.env as Record<string, string>,
        });
        const client = new Client({
          name: `cli-client-${config.name}`,
          version: '1.0.0',
        });
        await client.connect(transport);
        this.connections.set(config.name, { config, client, transport });
      })
    );
  }

  async listTools(): Promise<MCPTool[]> {
    if (this.connections.size === 0) throw new Error('Не подключён к MCP серверам');

    const allTools: MCPTool[] = [];
    this.toolServerMap.clear();

    for (const [serverName, conn] of this.connections) {
      const result = await conn.client.listTools();
      for (const tool of result.tools) {
        // Заполняем toolServerMap для ВСЕХ инструментов (включая internal),
        // чтобы callTool('check_fired_reminders') тоже корректно маршрутизировался.
        this.toolServerMap.set(tool.name, serverName);
        if (MCPClientManager.INTERNAL_TOOLS.has(tool.name)) continue; // скрыть от LLM
        allTools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
          serverName,
        });
      }
    }

    return allTools;
  }

  getServerForTool(name: string): string | undefined {
    return this.toolServerMap.get(name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (this.connections.size === 0) throw new Error('Не подключён к MCP серверам');

    // Найти сервер для этого инструмента
    let serverName = this.toolServerMap.get(name);

    // Если карта не заполнена — обновить
    if (!serverName) {
      await this.listTools();
      serverName = this.toolServerMap.get(name);
    }

    if (!serverName) {
      throw new Error(`Инструмент "${name}" не найден ни на одном сервере`);
    }

    const conn = this.connections.get(serverName);
    if (!conn) throw new Error(`Сервер "${serverName}" не подключён`);

    const result = await conn.client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    const textContent = content.find((c) => c.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;

    if (!textContent) throw new Error(`Инструмент "${name}" не вернул текстовый результат`);
    return textContent.text;
  }

  async disconnect(): Promise<void> {
    await Promise.all([...this.connections.values()].map((conn) => conn.client.close()));
    this.connections.clear();
    this.toolServerMap.clear();
  }
}
