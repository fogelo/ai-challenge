// src/mcp/server-web.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { get as httpsGet } from 'https';
import { get as httpGet } from 'http';

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const makeRequest = (currentUrl: string, redirectsLeft: number) => {
      const getter = currentUrl.startsWith('https://') ? httpsGet : httpGet;
      getter(currentUrl, { headers: { 'User-Agent': 'curl/7.0' } }, (res) => {
        const { statusCode, headers } = res;
        if ((statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) && headers.location) {
          if (redirectsLeft === 0) { reject(new Error('Too many redirects')); return; }
          const next = headers.location.startsWith('http') ? headers.location : new URL(headers.location, currentUrl).toString();
          res.resume();
          makeRequest(next, redirectsLeft - 1);
          return;
        }
        if (!statusCode || statusCode < 200 || statusCode >= 300) {
          reject(new Error(`HTTP ${statusCode ?? 'unknown'}`)); return;
        }
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve(data));
      }).on('error', reject);
    };
    makeRequest(url, 5);
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ').trim();
}

const server = new McpServer({ name: 'server-web', version: '1.0.0' });

server.registerTool(
  'search',
  {
    description: 'Получает текстовое содержимое веб-страницы по HTTPS URL. Возвращает очищенный от HTML текст (до 8000 символов). Используй как первый шаг пайплайна: search → summarize → saveToFile.',
    inputSchema: {
      url: z.string().describe('HTTPS URL страницы для анализа'),
    },
  },
  async ({ url }) => {
    try {
      if (!url.startsWith('https://')) {
        return { content: [{ type: 'text', text: '❌ Поддерживаются только HTTPS URL' }] };
      }
      const html = await fetchText(url);
      const text = stripHtml(html).slice(0, 8000);
      return { content: [{ type: 'text', text: text || '(пустая страница)' }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);

const transport = new StdioServerTransport();
(async () => { await server.connect(transport); })();
