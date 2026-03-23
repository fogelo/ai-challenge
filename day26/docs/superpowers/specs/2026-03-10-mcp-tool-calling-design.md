# MCP Tool Calling — Дизайн-спецификация

**Дата:** 2026-03-10
**Область:** День 17 — Полная интеграция MCP function calling

## Цель

Дать CLI-агенту возможность вызывать MCP-инструменты двумя способами:
1. **Через LLM** — LLM сам решает когда вызвать инструмент через OpenRouter function calling API
2. **Вручную** — пользователь вызывает `/mcp call <инструмент> [json-аргументы]` напрямую

Плюс визуальный индикатор в UI, показывающий какой инструмент сейчас вызывается.

## Архитектура и поток данных

```
Пользователь: "который час?"
  └→ Chat.tsx собирает список инструментов через mcpManager.listTools()
  └→ sendMessage(messages, tools=[get_time, echo, get_agent_info])
       └→ OpenRouter API возвращает { tool_calls: [{ name: "get_time", id: "call_1" }] }
  └→ UI показывает "🔧 Вызов MCP: get_time..."
  └→ mcpManager.callTool("get_time", {}) → "10 марта 2026, 14:32"
  └→ sendMessage(messages + tool_result, tools=[...])
       └→ OpenRouter API возвращает "Сейчас 14:32, 10 марта 2026"
  └→ Финальный ответ отображается в чате
```

## Изменяемые файлы

| Файл | Изменение |
|------|-----------|
| `src/types/index.ts` | Добавить `ToolCall`, роль `tool` в `Message`, поле `tool_call_id`, расширить `ApiResponse` |
| `src/mcp/client.ts` | Добавить метод `callTool(name, args)` |
| `src/api/openrouter.ts` | Принимать параметр `tools`, обрабатывать `tool_calls` в ответе |
| `src/components/Chat.tsx` | Tool-loop логика, state `activeMcpTool`, команда `/mcp call`, обновление `/help` |

## Новые типы (`src/types/index.ts`)

```ts
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// Message.role получает роль 'tool'
// Message получает опциональное поле tool_call_id?: string

// ApiResponse получает опциональное поле toolCalls?: ToolCall[]
```

## MCPClientManager.callTool

```ts
async callTool(name: string, args: Record<string, unknown>): Promise<string>
```

- Бросает ошибку если не подключён
- Возвращает первый `content[].text` из ответа MCP-инструмента

## Изменения sendMessage

Новый опциональный параметр: `tools?: MCPTool[]`

- Если передан — конвертирует список MCPTool в формат OpenRouter `tools`:
  ```json
  { "type": "function", "function": { "name": "...", "description": "...", "parameters": {...} } }
  ```
- `ApiResponse.toolCalls` заполняется когда `finish_reason === "tool_calls"`
- Сообщения с результатом инструмента используют `role: "tool"` с `tool_call_id`

## Tool-Loop в Chat.tsx

Заменяет единственный вызов `sendMessage` на цикл:

```
setActiveMcpTool(null)
цикл:
  response = sendMessage(messages, tools)
  если response.toolCalls:
    для каждого toolCall:
      setActiveMcpTool(toolCall.name)
      result = mcpManager.callTool(toolCall.name, toolCall.arguments)
      добавить tool_result в messages
  иначе:
    сохранить ответ ассистента
    выход из цикла
setActiveMcpTool(null)
```

Максимум итераций: 10 (защита от бесконечных циклов).

## Визуализация в UI

Новый state: `activeMcpTool: string | null`

В зоне индикатора загрузки:
- `isLoading && !activeMcpTool` → `[загрузка...]` (текущее поведение)
- `isLoading && activeMcpTool` → `🔧 Вызов MCP: get_time...` (новое)

## Ручная команда `/mcp call`

```
/mcp call get_time
/mcp call echo {"message": "привет"}
```

- Требует подключения к MCP (авто-подключается если не подключён)
- Показывает результат в зоне уведомлений
- Парсит опциональные JSON-аргументы; по умолчанию `{}`

## Обновление справки

В выводе `/help` секция MCP расширяется до:

```
📡 MCP:
  /mcp                           - подключиться и показать инструменты
  /mcp disconnect                - отключиться от сервера
  /mcp call <инструмент>         - вызвать инструмент вручную
  /mcp call <инструмент> <json>  - вызвать инструмент с параметрами
```

## Ограничения

- MCP должен быть подключён для LLM tool calling (авто-подключение при первом сообщении если инструменты доступны)
- Tool calling активируется только если MCP подключён; иначе — обычный чат
- Сообщения с `role: "tool"` НЕ сохраняются в историю сессии (они живут только внутри tool-loop)
