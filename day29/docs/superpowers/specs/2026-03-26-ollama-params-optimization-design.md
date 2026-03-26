# Дизайн: Параметры оптимизации Ollama

**Дата:** 2026-03-26
**День курса:** 29
**Задача:** Настройка параметров локальной LLM (temperature, max tokens, context window) с сохранением в config.json

---

## Контекст

Агент уже поддерживает переключение между провайдерами OpenRouter и Ollama через команду `/provider`. Параметр `temperature` работает для обоих провайдеров через state компонента Chat.tsx. Для Ollama нужно добавить параметры оптимизации: `maxTokens` (ограничение длины ответа) и `numCtx` (размер контекстного окна) — с персистентным сохранением в `config.json`.

**Известное ограничение:** `temperature` намеренно не персистируется (существующее поведение) — сбрасывается при перезапуске. `maxTokens` и `numCtx` будут персистироваться в `config.json`. Это небольшая несогласованность, принятая как есть для минимальности изменений.

---

## Затрагиваемые файлы

- `src/types/index.ts` — новый интерфейс `OllamaParams`, обновление `ModelConfig`
- `src/models/config.ts` — дефолты, миграция в `load()`, два новых метода
- `src/api/ollama.ts` — расширение `OllamaRequest` и сигнатуры `sendMessage`
- `src/api/index.ts` — обновление роутера для передачи новых параметров
- `src/components/Chat.tsx` — две новые команды + обновление статус-строки

---

## Архитектура и поток данных

```
config.json (ollamaParams)
    ↓ ConfigManager.getOllamaParams()
src/api/index.ts (роутер, аналог getProviderConfig())
    ↓ передаёт maxTokens, numCtx в sendMessageOllama()
src/api/ollama.ts → OllamaRequest { max_tokens, options: { num_ctx } }
    ↓
Ollama API /v1/chat/completions

Chat.tsx команды (/ollama:maxTokens, /ollama:numCtx)
    ↓ ConfigManager.setOllamaParams()
    → сохраняет в config.json (читается при следующем запросе через index.ts)
```

`getOllamaParams()` вызывается внутри `index.ts` (не в Chat.tsx) — по аналогии с тем, как `getProviderConfig()` уже вызывается там же для получения `ollamaBaseUrl` и `ollamaModel`.

---

## 1. Типы (`src/types/index.ts`)

```ts
export interface OllamaParams {
  maxTokens?: number;  // max_tokens в Ollama /v1/chat/completions (OpenAI-compatible)
  numCtx?: number;     // options.num_ctx — размер контекстного окна модели
}
```

Добавить поле в `ModelConfig`:

```ts
ollamaParams?: OllamaParams;
```

---

## 2. ConfigManager (`src/models/config.ts`)

### Дефолтные значения в `DEFAULT_CONFIG`

```ts
ollamaParams: {
  maxTokens: 2048,
  numCtx: 4096,
},
```

### Миграция в `load()`

По аналогии с существующими блоками (`provider`, `ollamaBaseUrl`, `strategy`, `summarization`):

```ts
if (!parsed.ollamaParams) {
  parsed.ollamaParams = DEFAULT_CONFIG.ollamaParams;
}
```

### Новые методы

```ts
getOllamaParams(): OllamaParams
// Возвращает текущие параметры с fallback на DEFAULT_CONFIG.ollamaParams

setOllamaParams(params: Partial<OllamaParams>): void
// Мержит с текущими и сохраняет в config.json
```

---

## 3. ollama.ts (`src/api/ollama.ts`)

### Расширение `OllamaRequest`

```ts
interface OllamaRequest {
  model: string;
  messages: unknown[];
  temperature?: number;
  max_tokens?: number;
  options?: { num_ctx?: number };
  tools?: unknown[];
  tool_choice?: 'auto';
}
```

### Расширение сигнатуры `sendMessage`

```ts
export async function sendMessage(
  messages: Message[],
  modelId: string,
  baseUrl: string,
  systemPrompt?: string,
  temperature?: number,
  tools?: MCPTool[],
  maxTokens?: number,
  numCtx?: number
): Promise<ApiResponse>
```

В `requestBody` параметры добавляются только если они определены:

```ts
...(maxTokens !== undefined && { max_tokens: maxTokens }),
...(numCtx !== undefined && { options: { num_ctx: numCtx } }),
```

---

## 4. index.ts роутер (`src/api/index.ts`)

Обновить `getSendMessage` (или эквивалентную функцию-роутер) — по аналогии с тем, как уже читается `getProviderConfig()`:

```ts
const { maxTokens, numCtx } = configManager.getOllamaParams();
// при вызове sendMessageOllama передать maxTokens, numCtx
```

---

## 5. Chat.tsx — команды

### `/ollama:maxTokens`

```
/ollama:maxTokens          → показать текущее значение
/ollama:maxTokens 1024     → установить и сохранить в config.json
```

**Валидация:** целое число от 64 до 32768. При выходе за границы — уведомление с допустимым диапазоном.

### `/ollama:numCtx`

```
/ollama:numCtx             → показать текущее значение
/ollama:numCtx 8192        → установить и сохранить в config.json
```

**Валидация:** целое число от 512 до 131072. Предупреждение если значение > 32768 (может не поддерживаться моделью).

### Статус-строка

Текущая строка (line ~2503):
```
Модель: {currentModel} | Temperature: {temperature}
```

Заменить на условный рендер:
- `provider === 'ollama'`: добавить `| MaxTok: {maxTokens} | Ctx: {numCtx}` после temperature
- `provider === 'openrouter'`: строка без изменений

### Команды в `/help`

```
/ollama:maxTokens [N]     - установить/показать max tokens для Ollama (64–32768)
/ollama:numCtx [N]        - установить/показать context window для Ollama (512–131072)
```

---

## 6. Тесты

- `src/api/ollama.test.ts` — добавить тест: `maxTokens` и `numCtx` попадают в `requestBody`
- `src/models/config.test.ts` — добавить тест: `getOllamaParams()` возвращает дефолты если поле отсутствует в конфиге

---

## План демо видео (~5 минут)

| Время | Действие |
|-------|----------|
| 0:00–0:30 | Запуск агента, `/provider ollama mistral-32k:latest`, `/provider` — статус с Ollama |
| 0:30–1:30 | **До оптимизации**: вопрос по коду (парсинг CSV на TypeScript), отмечаем время и длину ответа |
| 1:30–2:30 | Новые команды: `/ollama:numCtx 8192`, `/ollama:maxTokens 512`, объясняем что делает каждый параметр |
| 2:30–3:30 | **После**: тот же вопрос, сравниваем скорость и длину ответа |
| 3:30–4:00 | `/temperature 0.1` — детерминированный режим для кода, повторяем вопрос |
| 4:00–4:30 | Открываем `config.json` — параметры сохранены, перезапускаем агент — восстановились |
| 4:30–5:00 | Статус-строка показывает все активные параметры, итог по оптимизации |

---

## Ограничения

- `numCtx` работает только с Ollama (через поле `options`) — OpenRouter не получает этот параметр
- `maxTokens` маппится в `max_tokens` (OpenAI-compatible, поддерживается Ollama `/v1/chat/completions`)
- Квантование не реализуется в коде — выбор квантованной модели через `/provider ollama model:q4_0`
