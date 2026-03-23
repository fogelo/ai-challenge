# MCP Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить три MCP-инструмента (`search`, `summarize`, `saveToFile`) в существующий MCP-сервер для автоматического LLM-пайплайна.

**Architecture:** Три новых инструмента регистрируются в `src/mcp/server.ts`. LLM orchestrates chain automatically via existing tool-calling loop in `Chat.tsx`. No new files or dependencies needed.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, Node.js `https`/`fs` built-ins, OpenRouter API (global `fetch`, требует Node.js 18+)

---

## Chunk 1: Инструменты `search`, `summarize`, `saveToFile`

**Files:**
- Modify: `src/mcp/server.ts` — добавить три инструмента перед финальным блоком `const transport = ...`

---

### Task 1: Инструмент `search(url)`

Добавляет в `src/mcp/server.ts` инструмент для получения текстового содержимого HTTPS-страниц.

**Files:**
- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Добавить секцию и инструмент `search` в server.ts**

Примечание: `fetchText` уже определена в `server.ts` (строки 17–25) — `search` вызывает её напрямую, ничего добавлять не нужно.

Найти строку `// ──────────────────────────────────────────────────────────────────────────` перед `const transport = ...` и вставить ПЕРЕД ней:

```typescript
// ─── Pipeline ──────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

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
```

- [ ] **Step 2: Проверить компиляцию**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day19
npm run build
```

Ожидаем: выход без ошибок, файл `dist/mcp/server.js` обновлён.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: add search MCP tool for HTTPS page content fetching"
```

---

### Task 2: Инструмент `summarize(text, instructions?)`

Добавляет инструмент суммаризации через OpenRouter API.

**Files:**
- Modify: `src/mcp/server.ts`

- [ ] **Step 1: Добавить инструмент `summarize` после `search` в server.ts**

```typescript
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

      const userPrompt = instructions
        ? `${instructions}\n\nТекст:\n${text}`
        : `Текст:\n${text}`;

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'google/gemini-flash-1.5',
          messages: [
            {
              role: 'system',
              content: 'Ты помощник для суммаризации текста. Создай краткое резюме в 3-5 предложениях.',
            },
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
```

- [ ] **Step 2: Проверить компиляцию**

```bash
npm run build
```

Ожидаем: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: add summarize MCP tool using OpenRouter LLM"
```

---

### Task 3: Инструмент `saveToFile(filename, content)`

Добавляет инструмент сохранения результата в файл.

**Files:**
- Modify: `src/mcp/server.ts` — добавить import `fs/promises`, добавить инструмент

- [ ] **Step 1: Добавить import fs в верхушку server.ts**

В блоке импортов после `import { randomUUID } from 'crypto';` добавить:

```typescript
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
```

Примечание: `join` в `server.ts` НЕ импортирован (есть только `dirname` и `join` в `client.ts`, не в `server.ts`) — добавляем оба импорта как показано выше.

- [ ] **Step 2: Добавить инструмент `saveToFile` после `summarize`**

```typescript
server.registerTool(
  'saveToFile',
  {
    description: 'Сохраняет текст в файл в папке ./output/. Используй как последний шаг пайплайна после summarize.',
    inputSchema: {
      filename: z.string().describe('Имя файла (например: result.txt, summary.md)'),
      content: z.string().describe('Содержимое для сохранения'),
    },
  },
  async ({ filename, content }) => {
    try {
      const outputDir = join(process.cwd(), 'output');
      await mkdir(outputDir, { recursive: true });
      const filePath = join(outputDir, filename);
      await writeFile(filePath, content, 'utf-8');
      return { content: [{ type: 'text', text: `✅ Сохранено: ${filePath}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Ошибка: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  }
);
```

- [ ] **Step 3: Проверить компиляцию**

```bash
npm run build
```

Ожидаем: без ошибок.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: add saveToFile MCP tool for pipeline output"
```

---

### Task 4: Ручное тестирование пайплайна

- [ ] **Step 1: Запустить агент**

```bash
npm run dev
```

- [ ] **Step 2: Подключить MCP**

```
/mcp
```

Ожидаем в списке инструментов: `search`, `summarize`, `saveToFile` (плюс все существующие).

- [ ] **Step 3: Запустить пайплайн**

Написать в чате:

```
Возьми содержимое страницы https://en.wikipedia.org/wiki/Model_Context_Protocol, суммаризируй на русском языке и сохрани результат в файл mcp-summary.txt
```

Ожидаем: LLM последовательно вызывает `search` → `summarize` → `saveToFile`, в интерфейсе видны три вызова инструментов, в конце сообщение `✅ Сохранено: .../output/mcp-summary.txt`.

- [ ] **Step 4: Проверить файл**

```bash
cat output/mcp-summary.txt
```

Ожидаем: текст резюме на русском языке.

- [ ] **Step 5: Добавить `output/` в .gitignore**

```bash
echo "output/" >> .gitignore
```

- [ ] **Step 6: Финальный commit**

```bash
git add .gitignore
git commit -m "chore: ignore output/ directory"
```
