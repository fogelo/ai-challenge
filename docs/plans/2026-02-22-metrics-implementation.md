# Metrics Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add API request metrics display showing response time, token usage, and cost after each model response.

**Architecture:** Extend the OpenRouter API client to return full response data including usage metrics. Add state management in Chat component to track and display current request metrics and cumulative session statistics.

**Tech Stack:** TypeScript, React (Ink), OpenRouter API

---

## Task 1: Extend Type Definitions

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Add UsageInfo interface**

Add after the Message interface:

```typescript
export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
```

**Step 2: Update OpenRouterResponse interface**

Modify the existing OpenRouterResponse:

```typescript
export interface OpenRouterResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
  }>;
  usage?: UsageInfo;
}
```

**Step 3: Add ApiResponse interface**

Add after OpenRouterResponse:

```typescript
export interface ApiResponse {
  content: string;
  usage?: UsageInfo;
  responseTime: number;
}
```

**Step 4: Add SessionStats interface**

Add after ApiResponse:

```typescript
export interface SessionStats {
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  requestCount: number;
}
```

**Step 5: Build to verify types compile**

Run: `npm run build`
Expected: Successful build with no errors

**Step 6: Commit type definitions**

```bash
git add src/types/index.ts
git commit -m "feat: add metrics type definitions

Add types for API metrics tracking:
- UsageInfo for token usage data
- ApiResponse for enriched API response
- SessionStats for session statistics

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Update API Client

**Files:**
- Modify: `src/api/openrouter.ts`

**Step 1: Update import statement**

Change the import to include new types:

```typescript
import { Message, OpenRouterRequest, OpenRouterResponse, ApiResponse } from '../types/index.js';
```

**Step 2: Update function signature**

Change the return type from `Promise<string>` to `Promise<ApiResponse>`:

```typescript
export async function sendMessage(messages: Message[], systemPrompt?: string, temperature?: number): Promise<ApiResponse> {
```

**Step 3: Add timing measurement**

Add before the try block:

```typescript
  const startTime = performance.now();
```

**Step 4: Calculate response time**

Add after the fetch call (line 26), before parsing JSON:

```typescript
    const responseTime = (performance.now() - startTime) / 1000;
```

**Step 5: Update return statement**

Replace the current return statement (line 46) with:

```typescript
    return {
      content: data.choices[0].message.content,
      usage: data.usage,
      responseTime,
    };
```

**Step 6: Build to verify changes compile**

Run: `npm run build`
Expected: Successful build with no errors

**Step 7: Commit API client changes**

```bash
git add src/api/openrouter.ts
git commit -m "feat: extend API client to return metrics

Modify sendMessage to return ApiResponse with:
- Response content
- Token usage data from OpenRouter
- Response time measurement

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Metrics State to Chat Component

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Update imports**

Add to the imports from types (line 5):

```typescript
import { Message, UsageInfo, SessionStats } from '../types/index.js';
```

**Step 2: Add sessionStats state**

Add after the temperature state (after line 21):

```typescript
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
    requestCount: 0,
  });
```

**Step 3: Add lastResponseMetrics state**

Add after sessionStats:

```typescript
  const [lastResponseMetrics, setLastResponseMetrics] = useState<{
    responseTime: number;
    usage?: UsageInfo;
  } | null>(null);
```

**Step 4: Build to verify changes compile**

Run: `npm run build`
Expected: Successful build with no errors

**Step 5: Commit state additions**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add metrics state to Chat component

Add state for tracking:
- Last response metrics (time + usage)
- Session statistics (cumulative)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add Cost Calculation Helper

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add calculateCost function**

Add after the buildSystemPrompt function (after line 11):

```typescript
function calculateCost(usage: UsageInfo): number {
  // Примерные цены для Claude 3.5 Sonnet через OpenRouter
  // $3 per 1M input tokens, $15 per 1M output tokens
  const inputCost = (usage.prompt_tokens / 1_000_000) * 3;
  const outputCost = (usage.completion_tokens / 1_000_000) * 15;
  return inputCost + outputCost;
}
```

**Step 2: Build to verify changes compile**

Run: `npm run build`
Expected: Successful build with no errors

**Step 3: Commit helper function**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add cost calculation helper

Calculate API request cost based on token usage.
Uses Claude 3.5 Sonnet pricing via OpenRouter.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Update Message Handling Logic

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Clear metrics on new message**

In the useInput handler, add after line 89 (after `setNotification(null);`):

```typescript
        setLastResponseMetrics(null);
```

**Step 2: Update API call to receive full response**

Replace the sendMessage call and response handling (lines 100-102) with:

```typescript
          const apiResponse = await sendMessage(conversation.getHistory(), systemPrompt, temperature);

          // Сохраняем метрики последнего ответа
          setLastResponseMetrics({
            responseTime: apiResponse.responseTime,
            usage: apiResponse.usage,
          });

          // Обновляем статистику сессии (если есть usage)
          if (apiResponse.usage) {
            setSessionStats(prev => ({
              totalTokens: prev.totalTokens + apiResponse.usage!.total_tokens,
              totalPromptTokens: prev.totalPromptTokens + apiResponse.usage!.prompt_tokens,
              totalCompletionTokens: prev.totalCompletionTokens + apiResponse.usage!.completion_tokens,
              totalCost: prev.totalCost + calculateCost(apiResponse.usage!),
              requestCount: prev.requestCount + 1,
            }));
          }

          conversation.addAssistantMessage(apiResponse.content);
```

**Step 3: Build to verify changes compile**

Run: `npm run build`
Expected: Successful build with no errors

**Step 4: Commit logic updates**

```bash
git add src/components/Chat.tsx
git commit -m "feat: update message handling for metrics

- Clear metrics on new message send
- Capture response metrics from API
- Update session statistics

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add Metrics Display UI

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add metrics display component**

Add after the loading indicator block (after line 151) and before the notification block:

```typescript
      {lastResponseMetrics && (
        <Box flexDirection="column" marginBottom={1}>
          <Text dimColor>
            ⏱ {lastResponseMetrics.responseTime.toFixed(2)}s | 📊{' '}
            {lastResponseMetrics.usage
              ? `${lastResponseMetrics.usage.total_tokens} tokens (prompt: ${lastResponseMetrics.usage.prompt_tokens}, completion: ${lastResponseMetrics.usage.completion_tokens})`
              : 'N/A tokens'
            } | 💰{' '}
            {lastResponseMetrics.usage
              ? `$${calculateCost(lastResponseMetrics.usage).toFixed(6)}`
              : 'N/A'
            }
          </Text>
          <Text dimColor>
            📈 Session total:{' '}
            {sessionStats.requestCount > 0 && sessionStats.totalTokens > 0
              ? `${sessionStats.totalTokens} tokens | $${sessionStats.totalCost.toFixed(6)}`
              : 'N/A tokens | N/A'
            }
          </Text>
        </Box>
      )}
```

**Step 2: Build to verify changes compile**

Run: `npm run build`
Expected: Successful build with no errors

**Step 3: Test the application manually**

Run: `npm start`
Expected:
- Application starts without errors
- Send a test message
- See metrics displayed after assistant response
- Metrics show: response time, tokens, cost
- Session total updates on subsequent messages

**Step 4: Commit UI implementation**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add metrics display UI

Display metrics after each assistant response:
- Response time
- Token usage (total, prompt, completion)
- Request cost
- Cumulative session statistics

Shows N/A when usage data unavailable.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Update Documentation

**Files:**
- Modify: `README.md`

**Step 1: Add metrics section to README**

Add after the "Возможности" section (after line 10):

```markdown
- Метрики API запросов (время ответа, токены, стоимость)
- Накопительная статистика сессии
```

**Step 2: Update features description**

Update the "Возможности" heading section to reflect new feature:

```markdown
## Возможности

- Интерактивная REPL сессия
- Сохранение контекста диалога
- Поддержка различных моделей через OpenRouter
- Цветной вывод в терминале
- Метрики API запросов (время ответа, токены, стоимость)
- Накопительная статистика сессии
```

**Step 3: Commit documentation**

```bash
git add README.md
git commit -m "docs: update README with metrics feature

Document new metrics functionality:
- API request metrics
- Session statistics

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Final Verification

**Step 1: Full build test**

Run: `npm run build`
Expected: Clean build with no errors or warnings

**Step 2: Runtime test**

Run: `npm start`
Test scenarios:
1. Send a message and verify metrics appear
2. Send multiple messages and verify session stats accumulate
3. Verify metrics format matches design (compact single line)
4. Check that N/A displays correctly if usage data missing

**Step 3: Review git log**

Run: `git log --oneline -7`
Expected: 7 commits following conventional commits format

---

## Success Criteria

- ✅ Types compile without errors
- ✅ Metrics display after each response
- ✅ Session statistics accumulate correctly
- ✅ N/A shown when usage data unavailable
- ✅ Response time always displayed
- ✅ Cost calculation works
- ✅ UI matches approved design
- ✅ Documentation updated
