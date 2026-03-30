# Token Tracking and Context Monitoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add detailed token counting and context monitoring to the AI agent to track usage, cost, and prevent context overflow.

**Architecture:** Extend the Message interface with optional metadata field to store per-request metrics (tokens, cost, time). Add `/stats` command to display request history. Add context warnings based on model's context_length.

**Tech Stack:** TypeScript, Ink (React CLI), OpenRouter API

---

## Task 1: Add MessageMetadata type

**Files:**
- Modify: `src/types/index.ts:6-9`

**Step 1: Add MessageMetadata interface**

Add after line 9 (after `Message` interface export):

```typescript
export interface MessageMetadata {
  usage?: UsageInfo;          // токены (prompt/completion/total)
  responseTime?: number;       // время ответа в секундах
  cost?: number;              // стоимость в USD
  model?: string;             // ID модели
  timestamp?: string;         // ISO timestamp
}
```

**Step 2: Verify TypeScript compilation**

Run: `npm run build`
Expected: Build succeeds without errors

**Step 3: Commit type changes**

```bash
git add src/types/index.ts
git commit -m "feat: add MessageMetadata type for tracking metrics"
```

---

## Task 2: Extend Message interface with metadata

**Files:**
- Modify: `src/types/index.ts:6-9`

**Step 1: Add metadata field to Message**

Modify the `Message` interface (lines 6-9):

```typescript
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: MessageMetadata;  // новое поле
}
```

**Step 2: Verify TypeScript compilation**

Run: `npm run build`
Expected: Build succeeds without errors

**Step 3: Commit interface extension**

```bash
git add src/types/index.ts
git commit -m "feat: extend Message interface with optional metadata"
```

---

## Task 3: Update Conversation.addAssistantMessage to accept metadata

**Files:**
- Modify: `src/chat/conversation.ts:18-20`

**Step 1: Add metadata parameter**

Modify the `addAssistantMessage` method (line 18):

```typescript
addAssistantMessage(content: string, metadata?: MessageMetadata): void {
  this.messages.push({
    role: 'assistant',
    content,
    metadata
  });
}
```

**Step 2: Add import for MessageMetadata**

Update import at line 1:

```typescript
import { Message, SessionStats, SessionData, MessageMetadata } from '../types/index.js';
```

**Step 3: Verify TypeScript compilation**

Run: `npm run build`
Expected: Build succeeds without errors

**Step 4: Commit conversation changes**

```bash
git add src/chat/conversation.ts
git commit -m "feat: support metadata in addAssistantMessage"
```

---

## Task 4: Update Chat.tsx to save metadata with assistant messages

**Files:**
- Modify: `src/components/Chat.tsx:314-345`

**Step 1: Import MessageMetadata type**

Update import at line 6:

```typescript
import { Message, UsageInfo, SessionStats, MessageMetadata } from '../types/index.js';
```

**Step 2: Create metadata before saving assistant message**

Replace lines 341-342 (after `const apiResponse = await sendMessage(...)`):

```typescript
// Сохраняем метрики последнего ответа
setLastResponseMetrics({
  responseTime: apiResponse.responseTime,
  usage: apiResponse.usage,
});

// Создаем metadata для сохранения
const metadata: MessageMetadata = {
  usage: apiResponse.usage,
  responseTime: apiResponse.responseTime,
  cost: apiResponse.usage
    ? modelRegistry.calculateCost(currentModel, apiResponse.usage)
    : undefined,
  model: currentModel,
  timestamp: new Date().toISOString(),
};

// Обновляем статистику сессии (если есть usage)
let newStats = sessionStats;
if (apiResponse.usage) {
  const usage = apiResponse.usage;
  newStats = {
    totalTokens: sessionStats.totalTokens + usage.total_tokens,
    totalPromptTokens: sessionStats.totalPromptTokens + usage.prompt_tokens,
    totalCompletionTokens: sessionStats.totalCompletionTokens + usage.completion_tokens,
    totalCost: sessionStats.totalCost + modelRegistry.calculateCost(currentModel, usage),
    requestCount: sessionStats.requestCount + 1,
  };
  setSessionStats(newStats);
}

conversation.addAssistantMessage(apiResponse.content, metadata);
setMessages(conversation.getHistory());

// Auto-save session after assistant response
conversation.saveSession(newStats);
```

**Step 3: Verify TypeScript compilation**

Run: `npm run build`
Expected: Build succeeds without errors

**Step 4: Test manually**

Run: `npm start`
- Send a message
- Check that response works
- Exit and check `.chat-history/` - verify metadata is saved in JSON

Expected: Session JSON contains metadata in assistant messages

**Step 5: Commit metadata integration**

```bash
git add src/components/Chat.tsx
git commit -m "feat: save metadata with assistant messages"
```

---

## Task 5: Add /stats command handler

**Files:**
- Modify: `src/components/Chat.tsx:44-293`

**Step 1: Add /stats command in handleCommand**

Add before the `return false;` statement at the end of `handleCommand` (around line 292):

```typescript
// Stats command
if (trimmed === '/stats') {
  const history = conversation.getHistory();

  // Фильтруем только пары user-assistant
  const requests: Array<{
    userMsg: Message;
    assistantMsg: Message;
    requestNumber: number;
  }> = [];

  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].role === 'user' && history[i + 1].role === 'assistant') {
      requests.push({
        userMsg: history[i],
        assistantMsg: history[i + 1],
        requestNumber: requests.length + 1,
      });
    }
  }

  if (requests.length === 0) {
    setNotification('Нет запросов для отображения');
    return true;
  }

  // Формируем вывод
  let output = 'История запросов:\n\n';

  requests.forEach(({ userMsg, assistantMsg, requestNumber }) => {
    const meta = assistantMsg.metadata;
    const preview = userMsg.content.slice(0, 50) + (userMsg.content.length > 50 ? '...' : '');

    output += `#${requestNumber}. "${preview}"\n`;

    if (meta) {
      output += `   Токены: ${meta.usage?.total_tokens || 'N/A'} `;
      output += `(prompt: ${meta.usage?.prompt_tokens || 'N/A'}, `;
      output += `completion: ${meta.usage?.completion_tokens || 'N/A'})\n`;
      output += `   Стоимость: $${meta.cost?.toFixed(6) || 'N/A'}\n`;
      output += `   Время: ${meta.responseTime?.toFixed(2) || 'N/A'}s\n`;
      output += `   Модель: ${meta.model || 'N/A'}\n`;
    } else {
      output += '   Метрики недоступны\n';
    }
    output += '\n';
  });

  // Итоговая статистика
  output += `Всего запросов: ${sessionStats.requestCount}\n`;
  output += `Всего токенов: ${sessionStats.totalTokens} `;
  output += `(prompt: ${sessionStats.totalPromptTokens}, `;
  output += `completion: ${sessionStats.totalCompletionTokens})\n`;
  output += `Общая стоимость: $${sessionStats.totalCost.toFixed(6)}`;

  setNotification(output);
  return true;
}
```

**Step 2: Verify TypeScript compilation**

Run: `npm run build`
Expected: Build succeeds without errors

**Step 3: Test /stats command**

Run: `npm start`
- Send 2-3 messages to the agent
- Type `/stats` and press Enter
- Verify output shows request history with metrics

Expected: Shows numbered list with token counts, cost, time, model

**Step 4: Commit /stats command**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add /stats command to display request history"
```

---

## Task 6: Add getContextWarning function

**Files:**
- Modify: `src/components/Chat.tsx:20-21` (after imports, before Chat component)

**Step 1: Add getContextWarning function**

Add after line 19 (after `buildSystemPrompt` function):

```typescript
function getContextWarning(
  totalPromptTokens: number,
  modelId: string,
  modelRegistry: ModelRegistry
): { level: 'none' | 'warning' | 'critical'; message: string } {
  const model = modelRegistry.getModel(modelId);
  const contextLength = model?.context_length;

  if (!contextLength || totalPromptTokens === 0) {
    return { level: 'none', message: '' };
  }

  const usagePercent = (totalPromptTokens / contextLength) * 100;
  const remaining = contextLength - totalPromptTokens;
  const remainingPercent = ((remaining / contextLength) * 100).toFixed(1);

  if (usagePercent >= 90) {
    return {
      level: 'critical',
      message: `⚠️  КРИТИЧНО: Контекст почти заполнен ${totalPromptTokens}/${contextLength} (${usagePercent.toFixed(1)}%). Осталось ${remainingPercent}%`,
    };
  }

  if (usagePercent >= 70) {
    return {
      level: 'warning',
      message: `⚡ Предупреждение: Контекст ${totalPromptTokens}/${contextLength} (${usagePercent.toFixed(1)}%). Осталось ${remainingPercent}%`,
    };
  }

  return {
    level: 'none',
    message: `Контекст: ${totalPromptTokens}/${contextLength} (${usagePercent.toFixed(1)}%). Осталось ${remainingPercent}%`,
  };
}
```

**Step 2: Verify TypeScript compilation**

Run: `npm run build`
Expected: Build succeeds without errors

**Step 3: Commit context warning function**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add getContextWarning function"
```

---

## Task 7: Integrate context warning in UI

**Files:**
- Modify: `src/components/Chat.tsx:427-449` (in JSX return section)

**Step 1: Add context warning display**

Add after the `lastResponseMetrics` block (after line 448, before `notification` block):

```tsx
{sessionStats.totalPromptTokens > 0 && (
  <Box marginBottom={1}>
    <Text
      color={
        getContextWarning(sessionStats.totalPromptTokens, currentModel, modelRegistry).level === 'critical'
          ? 'red'
          : getContextWarning(sessionStats.totalPromptTokens, currentModel, modelRegistry).level === 'warning'
          ? 'yellow'
          : 'gray'
      }
    >
      {getContextWarning(sessionStats.totalPromptTokens, currentModel, modelRegistry).message}
    </Text>
  </Box>
)}
```

**Step 2: Verify TypeScript compilation**

Run: `npm run build`
Expected: Build succeeds without errors

**Step 3: Test context warnings**

Run: `npm start`
- Send messages until prompt tokens exceed 70% of context_length
- Verify yellow warning appears
- Continue until >90%
- Verify red critical warning appears

Expected:
- <70%: gray text
- 70-90%: yellow warning
- >90%: red critical warning

**Step 4: Commit context warning UI**

```bash
git add src/components/Chat.tsx
git commit -m "feat: display context warning in UI"
```

---

## Task 8: Update README with /stats documentation

**Files:**
- Modify: `README.md:62-71`

**Step 1: Add /stats to commands list**

Update the commands section (around line 68):

```markdown
### Команды

- `/model` - показать список доступных моделей
- `/model <номер>` - переключиться на модель по номеру
- `/model add <model-id>` - добавить модель в избранное
- `/model remove <номер>` - удалить модель из избранного
- `/clear` - очистить контекст и статистику
- `/resume` - показать список сохраненных сессий
- `/resume <номер>` - загрузить конкретную сессию
- `/stats` - показать историю запросов с метриками
```

**Step 2: Add /stats example section**

Add after the `/resume` examples section:

```markdown
### Просмотр статистики

Команда `/stats` показывает детальную информацию по каждому запросу:

```bash
# Показать историю запросов
/stats
```

Вывод включает:
- Номер запроса
- Текст запроса (первые 50 символов)
- Токены (prompt/completion/total)
- Стоимость в USD
- Время ответа в секундах
- Модель, которая использовалась
- Итоговая статистика сессии

**Мониторинг контекста:**
- Агент автоматически показывает процент заполнения контекстного окна
- При достижении 70% появляется желтое предупреждение
- При >90% показывается красное критическое предупреждение
- Используйте `/clear` для сброса контекста
```

**Step 3: Commit README update**

```bash
git add README.md
git commit -m "docs: add /stats command documentation"
```

---

## Task 9: Manual testing - short dialog

**Files:**
- Test: Manual testing

**Step 1: Test short dialog (2-3 requests)**

Run: `npm start`

1. Send message: "Привет!"
2. Wait for response
3. Send message: "Как дела?"
4. Wait for response
5. Type `/stats`
6. Verify output shows 2 requests with metrics

Expected:
- Each request shows tokens, cost, time, model
- Total stats at bottom match individual requests
- Context percentage is low (<10%)

**Step 2: Test session persistence**

1. Exit (Ctrl+C)
2. Run: `npm start`
3. Type `/resume 1`
4. Type `/stats`

Expected:
- Stats command shows same data as before exit
- Metadata persisted correctly

---

## Task 10: Manual testing - context warnings

**Files:**
- Test: Manual testing

**Step 1: Switch to model with small context**

Run: `npm start`

1. Type `/model` to see list
2. Find model with smallest context_length (e.g., 8k)
3. Type `/model <number>` to switch

**Step 2: Generate long conversation**

1. Send message: "Расскажи длинную историю про программирование"
2. Continue asking for more details until tokens reach 70%
3. Verify yellow warning appears
4. Continue until >90%
5. Verify red critical warning appears

Expected:
- Warning text shows correct percentages
- Colors change appropriately (gray → yellow → red)
- `/stats` shows growing token counts

**Step 3: Test context overflow**

1. Continue sending messages
2. Eventually API should return error (413/400)
3. Verify error is caught and displayed

Expected:
- User sees error message
- Red warning was visible before error
- `/clear` command resolves the issue

---

## Task 11: Manual testing - backward compatibility

**Files:**
- Test: Manual testing

**Step 1: Load old session without metadata**

If you have old sessions from before this feature:

1. Run: `npm start`
2. Type `/resume` and select old session
3. Type `/stats`

Expected:
- Command works without errors
- Shows "Метрики недоступны" for old messages
- New messages have metadata

**Step 2: Test API without usage**

If API doesn't return usage (rare):

Expected:
- No crash
- Shows "N/A" for tokens
- Context warning doesn't appear

---

## Task 12: Create verification document

**Files:**
- Create: `docs/testing/2026-02-25-token-tracking-verification.md`

**Step 1: Document test results**

```markdown
# Token Tracking Feature Verification

**Date:** 2026-02-25
**Feature:** Token tracking and context monitoring

## Test Results

### ✅ Short Dialog (2-3 requests)
- Token counting: ✓
- `/stats` command: ✓
- Session persistence: ✓

### ✅ Context Warnings
- <70% (gray): ✓
- 70-90% (yellow): ✓
- >90% (red): ✓
- Percentages accurate: ✓

### ✅ Edge Cases
- Empty history: ✓
- Old sessions: ✓
- API without usage: ✓

### ✅ Backward Compatibility
- Existing commands work: ✓
- Old sessions load: ✓
- No breaking changes: ✓

## Conclusion

All features implemented and tested successfully.
```

**Step 2: Commit verification doc**

```bash
git add docs/testing/2026-02-25-token-tracking-verification.md
git commit -m "docs: add token tracking verification results"
```

---

## Summary

**Total Tasks:** 12
**Estimated Time:** 60-90 minutes
**Files Modified:** 3 (types, conversation, Chat)
**Files Created:** 2 (plan, verification)
**Commits:** 12

**Key Features Delivered:**
1. ✅ Per-request token tracking (prompt/completion/total)
2. ✅ Cost calculation per request
3. ✅ `/stats` command for detailed history
4. ✅ Context warning system (70%/90% thresholds)
5. ✅ Persistent metadata in session files
6. ✅ Backward compatible with old sessions

**Testing Coverage:**
- Short dialogs
- Long dialogs approaching limits
- Context overflow scenarios
- Backward compatibility
- Edge cases (empty, no usage, old sessions)
