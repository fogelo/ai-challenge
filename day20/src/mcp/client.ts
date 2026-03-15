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
}

export class MCPClientManager {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  isConnected(): boolean {
    return this.client !== null;
  }

  async connect(): Promise<void> {
    if (this.client) return;

    const serverPath = join(__dirname, 'server.js');

    this.transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
    });

    this.client = new Client({
      name: 'day18-cli-client',
      version: '1.0.0',
    });

    await this.client.connect(this.transport);
  }

  // Инструменты, скрытые от LLM (используются только внутренним кодом)
  private static readonly INTERNAL_TOOLS = new Set(['check_fired_reminders']);

  async listTools(): Promise<MCPTool[]> {
    if (!this.client) throw new Error('Не подключён к MCP серверу');

    const result = await this.client.listTools();
    return result.tools
      .filter((tool) => !MCPClientManager.INTERNAL_TOOLS.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
      }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) throw new Error('Не подключён к MCP серверу');

    const result = await this.client.callTool({ name, arguments: args });

    const content = result.content as Array<{ type: string; text?: string }>;
    const textContent = content.find((c) => c.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;

    if (!textContent) throw new Error(`Инструмент "${name}" не вернул текстовый результат`);

    return textContent.text;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }
}
