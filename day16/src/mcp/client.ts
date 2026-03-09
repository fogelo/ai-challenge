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
      name: 'day16-cli-client',
      version: '1.0.0',
    });

    await this.client.connect(this.transport);
  }

  async listTools(): Promise<MCPTool[]> {
    if (!this.client) throw new Error('Не подключён к MCP серверу');

    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
    }));
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
  }
}
