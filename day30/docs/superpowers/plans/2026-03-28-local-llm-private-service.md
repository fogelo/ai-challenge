# Local LLM Private Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the CLI agent with rate limiting, context size check, and `/ollama:status` command to support a remote Ollama instance on a VPS.

**Architecture:** RateLimiter class (in-memory sliding window) is instantiated in Chat.tsx and called before every Ollama request. Context size is checked in Chat.tsx before each send; if messages exceed `numCtx * 0.9`, `performSummarization()` is called automatically. `/ollama:status` shows current URL, model, rate limit stats, and live connection check.

**Tech Stack:** TypeScript, Vitest, existing ConfigManager / Chat.tsx patterns

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| **Create** | `src/utils/rateLimiter.ts` | RateLimiter class — sliding-window counter |
| **Create** | `src/utils/rateLimiter.test.ts` | Unit tests for RateLimiter |
| **Modify** | `src/types/index.ts` | Add `RateLimitConfig`, update `ModelConfig` |
| **Modify** | `src/models/config.ts` | Add `getRateLimitConfig()`, default rateLimit |
| **Modify** | `src/components/Chat.tsx` | Context check before send, `/ollama:status` command, RateLimiter integration |
| **Modify** | `config.json` | Update `ollamaBaseUrl` to VPS IP, add `rateLimit` block |
| **Modify** | `README.md` | Add VPS setup section |

---

## Task 1: Add RateLimitConfig type and update ModelConfig

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add RateLimitConfig interface after OllamaParams**

Open `src/types/index.ts` and add after the `OllamaParams` interface (after line 175):

```typescript
export interface RateLimitConfig {
  /** Max requests per 60-second window */
  maxRequestsPerMinute: number;
}
```

- [ ] **Step 2: Add rateLimit field to ModelConfig**

In `src/types/index.ts`, find `ModelConfig` interface and add `rateLimit` field:

```typescript
export interface ModelConfig {
  currentModel: string;
  favoriteModels: string[];
  summarization: SummarizationConfig;
  strategy: StrategyConfig;
  provider: 'openrouter' | 'ollama';
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaParams?: OllamaParams;
  rateLimit?: RateLimitConfig;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add RateLimitConfig and rateLimit field to ModelConfig"
```

---

## Task 2: Add getRateLimitConfig to ConfigManager

**Files:**
- Modify: `src/models/config.ts`

- [ ] **Step 1: Add rateLimit to DEFAULT_CONFIG**

In `src/models/config.ts`, find `DEFAULT_CONFIG` and add `rateLimit` after `ollamaParams`:

```typescript
const DEFAULT_CONFIG: ModelConfig = {
  // ... existing fields ...
  ollamaParams: {
    maxTokens: 2048,
    numCtx: 4096,
  },
  rateLimit: {
    maxRequestsPerMinute: 10,
  },
};
```

- [ ] **Step 2: Add missing rateLimit default in load()**

In `src/models/config.ts`, in the `load()` method after the `ollamaParams` check block (around line 92):

```typescript
if (!parsed.rateLimit) {
  parsed.rateLimit = DEFAULT_CONFIG.rateLimit;
}
```

- [ ] **Step 3: Add getRateLimitConfig() method to ConfigManager**

Add after `getOllamaParams()` method:

```typescript
getRateLimitConfig(): { maxRequestsPerMinute: number } {
  return this.config.rateLimit ?? DEFAULT_CONFIG.rateLimit!;
}
```

- [ ] **Step 4: Verify build passes**

```bash
npm run build 2>&1 | tail -5
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/models/config.ts
git commit -m "feat(config): add rateLimit config with default 10 req/min"
```

---

## Task 3: Implement RateLimiter

**Files:**
- Create: `src/utils/rateLimiter.ts`
- Create: `src/utils/rateLimiter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/utils/rateLimiter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './rateLimiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows first request', () => {
    const limiter = new RateLimiter(5);
    const result = limiter.check();
    expect(result.allowed).toBe(true);
    expect(result.waitSeconds).toBe(0);
  });

  it('allows requests up to limit', () => {
    const limiter = new RateLimiter(3);
    limiter.record();
    limiter.record();
    const result = limiter.check();
    expect(result.allowed).toBe(true);
  });

  it('blocks when limit is reached', () => {
    const limiter = new RateLimiter(3);
    limiter.record();
    limiter.record();
    limiter.record();
    const result = limiter.check();
    expect(result.allowed).toBe(false);
    expect(result.waitSeconds).toBeGreaterThan(0);
  });

  it('allows requests again after window expires', () => {
    const limiter = new RateLimiter(2);
    limiter.record();
    limiter.record();
    expect(limiter.check().allowed).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(limiter.check().allowed).toBe(true);
  });

  it('getStats returns used count and limit', () => {
    const limiter = new RateLimiter(10);
    limiter.record();
    limiter.record();
    const stats = limiter.getStats();
    expect(stats.used).toBe(2);
    expect(stats.limit).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/utils/rateLimiter.test.ts 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module './rateLimiter.js'"

- [ ] **Step 3: Implement RateLimiter**

Create `src/utils/rateLimiter.ts`:

```typescript
/**
 * Sliding-window rate limiter (in-memory).
 * Tracks timestamps of recent requests within a 60-second window.
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs = 60_000;

  constructor(maxRequestsPerMinute: number) {
    this.maxRequests = maxRequestsPerMinute;
  }

  /** Prune timestamps older than 60 seconds */
  private prune(): void {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
  }

  /**
   * Check if a new request is allowed.
   * Does NOT record the request — call record() separately after the check.
   */
  check(): { allowed: boolean; waitSeconds: number } {
    this.prune();
    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (Date.now() - oldest);
      return { allowed: false, waitSeconds: Math.ceil(waitMs / 1000) };
    }
    return { allowed: true, waitSeconds: 0 };
  }

  /** Record that a request was made. Call after check() returns allowed=true. */
  record(): void {
    this.timestamps.push(Date.now());
  }

  /** Stats for /ollama:status display */
  getStats(): { used: number; limit: number; resetsIn: number } {
    this.prune();
    const oldest = this.timestamps[0];
    const resetsIn = oldest
      ? Math.ceil((this.windowMs - (Date.now() - oldest)) / 1000)
      : 0;
    return { used: this.timestamps.length, limit: this.maxRequests, resetsIn };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/utils/rateLimiter.test.ts 2>&1 | tail -10
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/rateLimiter.ts src/utils/rateLimiter.test.ts
git commit -m "feat(utils): add RateLimiter sliding-window implementation"
```

---

## Task 4: Integrate RateLimiter and context check into Chat.tsx

**Files:**
- Modify: `src/components/Chat.tsx`

This task adds three things:
1. RateLimiter instantiation
2. Rate limit check before each Ollama sendMessage call
3. Context size check before each Ollama sendMessage call

- [ ] **Step 1: Import RateLimiter in Chat.tsx**

Find the imports block at the top of `src/components/Chat.tsx`. Add after the `calculateApproximateTokens` import:

```typescript
import { RateLimiter } from '../utils/rateLimiter.js';
```

- [ ] **Step 2: Instantiate RateLimiter inside Chat component**

In `Chat.tsx`, find where component state is declared (around line 100–270, the `useState` block area). After the `configManager` usage, add RateLimiter instantiation. Find `const [isMcpConnected` (around line 270) and add BEFORE it:

```typescript
const rateLimiter = useRef<RateLimiter>(
  new RateLimiter(configManager.getRateLimitConfig().maxRequestsPerMinute)
).current;
```

- [ ] **Step 3: Add context size check helper inside Chat component**

Add after the `rateLimiter` line:

```typescript
function checkOllamaContext(messages: Message[]): boolean {
  const { provider } = configManager.getProviderConfig();
  if (provider !== 'ollama') return false;
  const { numCtx } = configManager.getOllamaParams();
  if (!numCtx) return false;
  return calculateApproximateTokens(messages) > numCtx * 0.9;
}
```

- [ ] **Step 4: Find message send handlers and add rate limit + context checks**

Search for the two places in Chat.tsx where `sendMessage(` is called for user messages (not summarization). They appear around line 479 and line 2247. The pattern is:

```typescript
// Check if summarization is needed before processing
```

For EACH of these two send locations, add BEFORE the `await sendMessage(` call:

```typescript
// Rate limit check (Ollama only)
if (configManager.getProviderConfig().provider === 'ollama') {
  const rl = rateLimiter.check();
  if (!rl.allowed) {
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant' as const,
        content: `⏱ Rate limit: подождите ${rl.waitSeconds} сек. (${configManager.getRateLimitConfig().maxRequestsPerMinute} req/min)`,
      },
    ]);
    setIsLoading(false);
    return;
  }
  rateLimiter.record();
}

// Context size check (Ollama only)
if (checkOllamaContext(conversation.getHistory())) {
  await performSummarization();
}
```

Note: add `rateLimiter.record()` only BEFORE the actual `await sendMessage(` line, not before `performSummarization`. Make sure you place the rate limit check after the `setIsLoading(true)` line and before the API call.

- [ ] **Step 5: Build to verify no TypeScript errors**

```bash
npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): add rate limiting and context size check for Ollama provider"
```

---

## Task 5: Add /ollama:status command

**Files:**
- Modify: `src/components/Chat.tsx`

- [ ] **Step 1: Add status command handler**

In `src/components/Chat.tsx`, find the `/ollama:numCtx` handler block (ends around line 631). Add AFTER it (before `// Skills commands`):

```typescript
if (trimmed === '/ollama:status') {
  const { provider, ollamaBaseUrl, ollamaModel } = configManager.getProviderConfig();
  if (provider !== 'ollama') {
    setNotification('ℹ️ Провайдер сейчас: openrouter (не Ollama)');
    return true;
  }
  const stats = rateLimiter.getStats();
  const statusLines = [
    `🖥  Ollama URL: ${ollamaBaseUrl}`,
    `🤖 Модель: ${ollamaModel}`,
    `⏱  Rate limit: ${stats.used}/${stats.limit} req/min${stats.resetsIn > 0 ? ` (сброс через ${stats.resetsIn}с)` : ''}`,
  ];

  // Async connection check
  fetch(`${ollamaBaseUrl}/api/tags`)
    .then((r) => {
      const icon = r.ok ? '✅' : '❌';
      setNotification(statusLines.join('\n') + `\n${icon} Соединение: ${r.ok ? 'OK' : `HTTP ${r.status}`}`);
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      setNotification(statusLines.join('\n') + `\n❌ Соединение: ${msg}`);
    });

  setNotification(statusLines.join('\n') + '\n🔄 Проверяю соединение...');
  return true;
}
```

- [ ] **Step 2: Add /ollama:status to help text**

Find line `1822` area with `/ollama:maxTokens` in the help text. Add `/ollama:status` entry:

```
/ollama:status            - статус Ollama (URL, модель, rate limit, соединение)
```

Also find the status bar help area around line 2561 with `/ollama:maxTokens [N]` and add:

```tsx
<Text color="yellow">/ollama:status</Text> - статус Ollama |{' '}
```

- [ ] **Step 3: Build to verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): add /ollama:status command with rate limit stats and connection check"
```

---

## Task 6: Update config.json with VPS settings

**Files:**
- Modify: `config.json`

- [ ] **Step 1: Update config.json**

Replace the `ollamaBaseUrl` value with your VPS IP (you'll know it after provisioning the server). Also add `rateLimit` block. Edit `config.json`:

```json
{
  "currentModel": "anthropic/claude-3.5-sonnet",
  "favoriteModels": [
    "google/gemini-flash-1.5",
    "meta-llama/llama-3.1-8b-instruct",
    "anthropic/claude-3-haiku",
    "openai/gpt-4o-mini",
    "anthropic/claude-3.5-sonnet",
    "openai/gpt-4o"
  ],
  "summarization": {
    "threshold": 0.7,
    "keepRecentMessages": 10
  },
  "strategy": {
    "default": "sliding",
    "slidingWindow": { "size": 10 },
    "stickyFacts": { "windowSize": 10 },
    "branching": { "maxCheckpoints": 20 }
  },
  "provider": "ollama",
  "ollamaBaseUrl": "http://<VPS_IP>:11434",
  "ollamaModel": "llama3.1:8b",
  "ollamaParams": {
    "maxTokens": 1024,
    "numCtx": 8192
  },
  "rateLimit": {
    "maxRequestsPerMinute": 10
  }
}
```

Replace `<VPS_IP>` with the actual IP after provisioning.

- [ ] **Step 2: Commit**

```bash
git add config.json
git commit -m "config: point ollamaBaseUrl to VPS, add rateLimit block"
```

---

## Task 7: Update README with VPS setup instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add VPS setup section to README.md**

Open `README.md` and add a new section at the end (before or after ## Архитектура):

```markdown
## Развёртывание локальной LLM на VPS (День 30)

### Требования к серверу

- OS: Ubuntu 22.04
- RAM: 8 GB минимум для llama3.1:8b
- Диск: 20+ GB свободно

### Шаг 1: Аренда VPS

Рекомендуемые провайдеры:
- **Hetzner** — CX31 (2 vCPU, 8GB, €10/мес), Helsinki
- **DigitalOcean** — Basic $24/мес (2 vCPU, 4GB)
- **Vultr** — High Performance $24/мес

### Шаг 2: Установка Ollama на сервере

```bash
# Подключиться к серверу
ssh root@<VPS_IP>

# Установить Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Скачать модель (1.3 GB)
ollama pull llama3.2:1b

# Или более мощную (4.7 GB, нужно 8 GB RAM)
ollama pull llama3.1:8b
```

### Шаг 3: Запуск Ollama с публичным биндингом

```bash
# Запустить и открыть порт для всех интерфейсов
OLLAMA_HOST=0.0.0.0 ollama serve &

# Открыть порт в firewall
ufw allow 11434
ufw enable
```

### Шаг 4: Проверить доступность с локальной машины

```bash
curl http://<VPS_IP>:11434/api/tags
```

Ожидаемый ответ: JSON со списком установленных моделей.

### Шаг 5: Настроить агент

В `config.json` обновить:
```json
{
  "provider": "ollama",
  "ollamaBaseUrl": "http://<VPS_IP>:11434",
  "ollamaModel": "llama3.1:8b"
}
```

### Шаг 6: Проверить в агенте

```bash
npm start
/ollama:status
```

Ожидаемый вывод:
```
🖥  Ollama URL: http://<VPS_IP>:11434
🤖 Модель: llama3.1:8b
⏱  Rate limit: 0/10 req/min
✅ Соединение: OK
```

### Остановка сервиса после демо

```bash
# На сервере
pkill ollama

# Закрыть порт
ufw delete allow 11434
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add VPS setup instructions for local LLM service"
```

---

## Task 8: Run full test suite

- [ ] **Step 1: Run all tests**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all existing tests pass, 5 new rateLimiter tests pass.

- [ ] **Step 2: Build production bundle**

```bash
npm run build 2>&1 | tail -5
```

Expected: `dist/` built with no errors.

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve any test/build issues"
```
