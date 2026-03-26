# MCP Tool Calling — План реализации

> **Для агентов:** ОБЯЗАТЕЛЬНО использовать superpowers:subagent-driven-development (если доступны сабагенты) или superpowers:executing-plans. Шаги используют синтаксис чекбоксов (`- [ ]`) для отслеживания.

**Цель:** Интегрировать полный MCP function calling — LLM автономно вызывает MCP-инструменты в ходе разговора, с визуальной обратной связью в UI и ручной командой `/mcp call`.

**Архитектура:** Расширить `MCPClientManager` методом `callTool()`, обновить `sendMessage()` для приёма и обработки `tools` в формате OpenAI, добавить tool-loop в `Chat.tsx` который работает пока LLM не вернёт финальный текстовый ответ, добавить state `activeMcpTool` для визуализации.

**Технологии:** TypeScript, Ink (React для CLI), `@modelcontextprotocol/sdk`, OpenRouter API (формат function calling, совместимый с OpenAI)

**Спецификация:** `docs/superpowers/specs/2026-03-10-mcp-tool-calling-design.md`

---

## Чанк 1: Типы + MCPClientManager.callTool

### Задача 1: Расширить типы в `src/types/index.ts`

**Файлы:**
- Изменить: `src/types/index.ts`

- [ ] **Шаг 1: Добавить интерфейс `ToolCall` и расширить `Message` и `ApiResponse`**

Открыть `src/types/index.ts`. Добавить после существующего интерфейса `UsageInfo`:

```ts
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
```

Изменить `Message.role` с:
```ts
role: 'user' | 'assistant' | 'system';
```
на:
```ts
role: 'user' | 'assistant' | 'system' | 'tool';
```

Добавить два опциональных поля в `Message`:
```ts
tool_call_id?: string;
tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
```

Расширить `ApiResponse` — добавить одно опциональное поле:
```ts
toolCalls?: ToolCall[];
```

Также добавить `tools` и `tool_choice` в `OpenRouterRequest`:
```ts
export interface OpenRouterRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  tools?: unknown[];
  tool_choice?: 'auto';
}
```

Обновить `OpenRouterResponse` для обработки tool_calls:
```ts
export interface OpenRouterResponse {
  choices: Array<{
    message: {
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: UsageInfo;
}
```

- [ ] **Шаг 2: Проверить что TypeScript компилируется**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day17
npm run build
```

Ожидается: без ошибок. Если появятся ошибки про `role: 'tool'` в существующем коде — исправить сужением типов на местах вызова.

- [ ] **Шаг 3: Коммит**

```bash
git add src/types/index.ts
git commit -m "feat: add ToolCall type and extend Message/ApiResponse/OpenRouterResponse for tool calling"
```

---

### Задача 2: Добавить `callTool()` в `MCPClientManager`

**Файлы:**
- Изменить: `src/mcp/client.ts`

- [ ] **Шаг 1: Добавить метод `callTool`**

Открыть `src/mcp/client.ts`. После метода `listTools()` добавить:

```ts
async callTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (!this.client) throw new Error('Не подключён к MCP серверу');

  const result = await this.client.callTool({ name, arguments: args });

  const textContent = result.content.find((c: { type: string }) => c.type === 'text') as
    | { type: 'text'; text: string }
    | undefined;

  if (!textContent) throw new Error(`Инструмент "${name}" не вернул текстовый результат`);

  return textContent.text;
}
```

- [ ] **Шаг 2: Сборка для проверки типов**

```bash
npm run build
```

Ожидается: чистая сборка.

- [ ] **Шаг 3: Быстрый ручной smoke-тест**

```bash
npm run dev
```

Ввести `/mcp` — убедиться что подключение работает и список инструментов появляется. Ввести `/mcp disconnect`. Выйти Ctrl+C.

- [ ] **Шаг 4: Коммит**

```bash
git add src/mcp/client.ts
git commit -m "feat: add callTool() to MCPClientManager"
```

---

## Чанк 2: Поддержка tool calling в OpenRouter

### Задача 3: Расширить путь запроса — отправлять tools в OpenRouter

**Файлы:**
- Изменить: `src/api/openrouter.ts`
- Изменить: `src/mcp/index.ts` (ре-экспорт MCPTool для импорта)

- [ ] **Шаг 1: Проверить экспорт `MCPTool` из MCP модуля**

Открыть `src/mcp/index.ts`. Убедиться что `MCPTool` уже экспортируется (должно быть из существующего кода). Если нет — добавить:
```ts
export type { MCPTool } from './client.js';
```

- [ ] **Шаг 2: Добавить импорт и вспомогательный тип в `openrouter.ts`**

Открыть `src/api/openrouter.ts`. Добавить вверху, после существующих импортов:

```ts
import { ToolCall } from '../types/index.js';
import type { MCPTool } from '../mcp/index.js';

interface OpenRouterTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}
```

- [ ] **Шаг 3: Обновить сигнатуру функции — добавить параметр `tools`**

Изменить:
```ts
export async function sendMessage(
  messages: Message[],
  modelId: string,
  systemPrompt?: string,
  temperature?: number
): Promise<ApiResponse>
```

на:
```ts
export async function sendMessage(
  messages: Message[],
  modelId: string,
  systemPrompt?: string,
  temperature?: number,
  tools?: MCPTool[]
): Promise<ApiResponse>
```

- [ ] **Шаг 4: Построить `allMessages` с полями для tool calling**

Найти существующее построение `allMessages`:
```ts
const allMessages: Message[] = systemPrompt
  ? [{ role: 'system', content: systemPrompt }, ...messages]
  : messages;
```

Заменить версией которая пробрасывает поля `tool_call_id` и `tool_calls` для multi-turn tool calling:
```ts
const allMessages = (systemPrompt
  ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
  : messages
).map((m) => {
  const msg: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
  if (m.tool_calls) msg.tool_calls = m.tool_calls;
  return msg;
});
```

- [ ] **Шаг 5: Конвертировать список MCPTool в формат OpenRouter и добавить в тело запроса**

После построения `allMessages` добавить:

```ts
const openRouterTools: OpenRouterTool[] | undefined =
  tools && tools.length > 0
    ? tools.map((tool) => {
        // inputSchema MCP может быть плоской картой имён свойств к zod-схемам,
        // или уже JSON Schema объектом. Оборачиваем в стандартный JSON Schema конверт.
        const hasProperties = tool.inputSchema && Object.keys(tool.inputSchema).length > 0;
        return {
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: hasProperties
              ? {
                  type: 'object',
                  properties: tool.inputSchema,
                  // НЕ помечаем все как required — LLM сам решит на основе описаний
                }
              : { type: 'object', properties: {} },
          },
        };
      })
    : undefined;
```

Обновить `requestBody` — добавить tools когда они есть:
```ts
const requestBody: OpenRouterRequest = {
  model: modelId,
  messages: allMessages as Message[],
  ...(temperature !== undefined && { temperature }),
  ...(openRouterTools && { tools: openRouterTools, tool_choice: 'auto' }),
};
```

- [ ] **Шаг 6: Сборка для проверки**

```bash
npm run build
```

Ожидается: чистая сборка.

- [ ] **Шаг 7: Коммит изменений пути запроса**

```bash
git add src/api/openrouter.ts src/mcp/index.ts
git commit -m "feat: extend sendMessage() request path with OpenRouter function calling tools"
```

---

### Задача 4: Расширить путь ответа — парсить tool_calls из ответа OpenRouter

**Файлы:**
- Изменить: `src/api/openrouter.ts`

- [ ] **Шаг 1: Парсить `tool_calls` из ответа API**

В `openrouter.ts` найти существующий блок возврата:
```ts
return {
  content: data.choices[0].message.content,
  usage: data.usage,
  responseTime,
};
```

Заменить на:
```ts
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
```

- [ ] **Шаг 2: Сборка для проверки**

```bash
npm run build
```

Ожидается: чистая сборка.

- [ ] **Шаг 3: Коммит**

```bash
git add src/api/openrouter.ts
git commit -m "feat: parse tool_calls in sendMessage() response for MCP tool-calling loop"
```

---

## Чанк 3: Chat.tsx — tool-loop, UI, ручная команда, справка

### Задача 5: Добавить state `activeMcpTool` и индикатор в UI

**Файлы:**
- Изменить: `src/components/Chat.tsx`

- [ ] **Шаг 1: Добавить state `activeMcpTool`**

В `Chat.tsx` найти блок объявлений `useState` (примерно строки 197–225). Добавить:

```ts
const [activeMcpTool, setActiveMcpTool] = useState<string | null>(null);
```

- [ ] **Шаг 2: Обновить индикатор загрузки в JSX**

Найти секцию индикатора загрузки (примерно строка 1703):
```tsx
{isLoading && (
  <Box>
    <Text bold color="blue">
      Assistant:{' '}
    </Text>
    <Text dimColor>[загрузка...]</Text>
  </Box>
)}
```

Заменить на:
```tsx
{isLoading && (
  <Box>
    <Text bold color="blue">
      Assistant:{' '}
    </Text>
    {activeMcpTool ? (
      <Text color="magenta">🔧 Вызов MCP: {activeMcpTool}...</Text>
    ) : (
      <Text dimColor>[загрузка...]</Text>
    )}
  </Box>
)}
```

- [ ] **Шаг 3: Сборка для проверки**

```bash
npm run build
```

Ожидается: чистая сборка.

- [ ] **Шаг 4: Коммит**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add activeMcpTool state and MCP tool call indicator in Chat UI"
```

---

### Задача 6: Заменить единственный вызов `sendMessage` на tool-loop

**Файлы:**
- Изменить: `src/components/Chat.tsx`
- Изменить: `src/api/openrouter.ts` (обновить импорт используемый в Chat)

- [ ] **Шаг 1: Импортировать тип `MCPTool` в `Chat.tsx`**

Найти существующую строку импорта MCP:
```ts
import { MCPClientManager } from '../mcp/index.js';
```

Заменить на:
```ts
import { MCPClientManager, MCPTool } from '../mcp/index.js';
```

- [ ] **Шаг 2: Заменить основной вызов `sendMessage` на tool-loop**

Найти этот точный блок в `Chat.tsx` (примерно строка 1450):
```ts
const apiResponse = await sendMessage(
  apiMessages,
  currentModel,
  systemPrompt,
  temperature
);
```

Заменить следующим tool-loop. Имя переменной `apiResponse` сохраняется — весь код ниже (проверка инвариантов, метаданные, статистика) продолжает работать без изменений. Сообщения с инструментами хранятся только в `loopMessages` и НЕ добавляются в постоянную историю `conversation`:

```ts
// Получить MCP-инструменты если подключены (включает LLM-driven tool calling)
const mcpTools: MCPTool[] = mcpManager.isConnected()
  ? await mcpManager.listTools()
  : [];

// Tool-calling loop: повторять пока LLM не вернёт финальный текстовый ответ
// loopMessages — локальная копия, ходы с инструментами НЕ сохраняются в историю разговора
let loopMessages = [...apiMessages];
let apiResponse = await sendMessage(
  loopMessages,
  currentModel,
  systemPrompt,
  temperature,
  mcpTools.length > 0 ? mcpTools : undefined
);

const MAX_TOOL_ITERATIONS = 10;
let toolIteration = 0;

while (apiResponse.toolCalls && apiResponse.toolCalls.length > 0 && toolIteration < MAX_TOOL_ITERATIONS) {
  toolIteration++;

  // Добавить ход ассистента (с tool_calls) только в локальный контекст
  loopMessages.push({
    role: 'assistant',
    content: apiResponse.content ?? '',
    tool_calls: apiResponse.toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.arguments),
      },
    })),
  });

  // Выполнить каждый вызов инструмента и добавить результаты в локальный контекст
  for (const toolCall of apiResponse.toolCalls) {
    setActiveMcpTool(toolCall.name);

    let toolResult: string;
    try {
      toolResult = await mcpManager.callTool(toolCall.name, toolCall.arguments);
    } catch (err) {
      toolResult = `Ошибка вызова инструмента: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Сообщение role: 'tool' добавляется только в loopMessages, НЕ в историю разговора
    loopMessages.push({
      role: 'tool',
      content: toolResult,
      tool_call_id: toolCall.id,
    });
  }

  setActiveMcpTool(null);

  // Запросить следующий ответ LLM (может вернуть ещё вызов инструмента или финальный ответ)
  apiResponse = await sendMessage(
    loopMessages,
    currentModel,
    systemPrompt,
    temperature,
    mcpTools.length > 0 ? mcpTools : undefined
  );
}

// Сбросить индикатор даже если цикл вышел по MAX_TOOL_ITERATIONS
setActiveMcpTool(null);
```

- [ ] **Шаг 3: Сборка**

```bash
npm run build
```

Ожидается: чистая сборка. Исправить любые ошибки типов (например, сужение `role: 'tool'`).

- [ ] **Шаг 4: Коммит**

```bash
git add src/components/Chat.tsx
git commit -m "feat: implement MCP tool-calling loop in Chat.tsx (LLM-driven tool use)"
```

---

### Задача 7: Добавить ручную команду `/mcp call` и обновить `/help`

**Файлы:**
- Изменить: `src/components/Chat.tsx`

- [ ] **Шаг 1: Добавить обработчик `/mcp call` в `handleCommand()`**

Найти блок MCP команд в `handleCommand()`. После обработчика `/mcp disconnect` и перед `return false` добавить:

```ts
if (trimmed.startsWith('/mcp call')) {
  const rest = trimmed.slice('/mcp call'.length).trim();
  if (!rest) {
    setNotification(
      'Использование: /mcp call <инструмент> [json-аргументы]\n' +
      'Пример: /mcp call get_time\n' +
      'Пример: /mcp call echo {"message":"привет"}'
    );
    return true;
  }

  // Парсинг: первый токен = имя инструмента, остаток = опциональные JSON-аргументы
  const spaceIdx = rest.indexOf(' ');
  const toolName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  const argsStr = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();

  let args: Record<string, unknown> = {};
  if (argsStr) {
    try {
      args = JSON.parse(argsStr) as Record<string, unknown>;
    } catch {
      setNotification(`❌ Неверный JSON: ${argsStr}`);
      return true;
    }
  }

  try {
    if (!mcpManager.isConnected()) {
      setNotification('⏳ Подключение к MCP серверу...');
      await mcpManager.connect();
    }

    setNotification(`⏳ Вызов инструмента: ${toolName}...`);
    const result = await mcpManager.callTool(toolName, args);
    setNotification(`🔧 ${toolName}:\n\n${result}`);
  } catch (err) {
    setNotification(
      `❌ Ошибка вызова инструмента: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return true;
}
```

- [ ] **Шаг 2: Обновить секцию MCP в `/help`**

Найти секцию MCP в строке справки:
```ts
📡 MCP:
  /mcp                      - подключиться и показать инструменты
  /mcp disconnect           - отключиться от сервера
```

Заменить на:
```ts
📡 MCP:
  /mcp                           - подключиться и показать инструменты
  /mcp disconnect                - отключиться от сервера
  /mcp call <инструмент>         - вызвать инструмент вручную
  /mcp call <инструмент> <json>  - вызвать инструмент с параметрами
```

- [ ] **Шаг 3: Сборка**

```bash
npm run build
```

Ожидается: чистая сборка.

- [ ] **Шаг 4: Коммит**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add /mcp call manual command and update /help docs"
```

---

### Задача 8: Сквозная ручная проверка

**Фреймворк для тестов не установлен. Проверяем вручную.**

- [ ] **Шаг 1: Запустить агент и убедиться что MCP сервер работает**

```bash
cd /Users/antor/Desktop/learn2/gladkov-challenge/ai-challenge/day17
npm start
```

Ввести `/mcp`. Ожидается:
```
✅ MCP сервер подключён

Доступные инструменты (3):

🔧 get_time
   Возвращает текущее дату и время

🔧 echo
   Повторяет переданное сообщение

🔧 get_agent_info
   Возвращает информацию о CLI агенте
```

Если список инструментов не появился или отличается — остановиться и проверить `src/mcp/server.ts`.

- [ ] **Шаг 2: Проверить что `/help` показывает новые MCP команды**

Ввести `/help`. Ожидается в секции MCP:
```
📡 MCP:
  /mcp                           - подключиться и показать инструменты
  /mcp disconnect                - отключиться от сервера
  /mcp call <инструмент>         - вызвать инструмент вручную
  /mcp call <инструмент> <json>  - вызвать инструмент с параметрами
```

- [ ] **Шаг 3: Тест ручного вызова — без аргументов**

Ввести `/mcp call get_time`.

Ожидается: уведомление показывает текущую дату/время от MCP сервера.

- [ ] **Шаг 4: Тест ручного вызова — с JSON аргументами**

Ввести `/mcp call echo {"message":"привет от ручного вызова"}`.

Ожидается: уведомление показывает `echo:\n\nпривет от ручного вызова`.

- [ ] **Шаг 5: Тест LLM-driven вызова — get_time**

Ввести (на естественном языке): `который сейчас час?`

Ожидаемая последовательность:
1. Во время ожидания: индикатор загрузки показывает `🔧 Вызов MCP: get_time...`
2. Финальный ответ ассистента в чате содержит текущее время

Если индикатор не появился — проверить что модель поддерживает function calling (Claude 3.5 Sonnet поддерживает).

- [ ] **Шаг 6: Тест LLM-driven вызова — echo**

Ввести: `повтори фразу "hello world" используя инструмент echo`

Ожидается: ассистент вызывает инструмент `echo` и включает возвращённый текст в свой ответ.

- [ ] **Шаг 7: Коммит**

```bash
git add docs/superpowers/plans/2026-03-10-mcp-tool-calling.md
git commit -m "chore: mark verification steps complete in MCP tool calling plan"
```
