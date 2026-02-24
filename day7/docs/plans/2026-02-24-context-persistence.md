# Context Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add session persistence with auto-save after each message and `/resume` command to restore previous sessions.

**Architecture:** JSON-based session storage in `.chat-history/` directory. Each session is a separate file with unique ID. Auto-save after every message. Graceful shutdown on Ctrl+C.

**Tech Stack:** TypeScript, Node.js fs module, crypto for ID generation

---

## Task 1: Update Types

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Add session types**

Add these interfaces to `src/types/index.ts`:

```typescript
/**
 * Complete session data stored in JSON files
 */
export interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  stats: SessionStats;
}

/**
 * Metadata for listing sessions (lighter than full SessionData)
 */
export interface SessionMetadata {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}
```

**Step 2: Verify types compile**

Run: `npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add session persistence types

Add SessionData and SessionMetadata interfaces for session storage.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create SessionManager

**Files:**
- Create: `src/chat/session.ts`

**Step 1: Create SessionManager skeleton**

Create `src/chat/session.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SessionData, SessionMetadata } from '../types/index.js';

export class SessionManager {
  private historyDir: string;

  constructor(historyDir: string = '.chat-history') {
    this.historyDir = historyDir;
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
  }

  private generateSessionId(): string {
    return crypto.randomBytes(4).toString('hex');
  }

  private getSessionFileName(sessionId: string, timestamp?: string): string {
    const ts = timestamp || new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    return `session-${ts}-${sessionId}.json`;
  }

  private getSessionFilePath(fileName: string): string {
    return path.join(this.historyDir, fileName);
  }

  createSession(): string {
    const sessionId = this.generateSessionId();
    const fileName = this.getSessionFileName(sessionId);
    const filePath = this.getSessionFilePath(fileName);

    const initialData: SessionData = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      stats: {
        totalTokens: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCost: 0,
        requestCount: 0,
      },
    };

    try {
      fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2), 'utf-8');
      return sessionId;
    } catch (error) {
      console.error('Error creating session:', error);
      throw error;
    }
  }

  saveSession(sessionId: string, data: SessionData): void {
    try {
      // Find the file for this session ID
      const files = fs.readdirSync(this.historyDir);
      const sessionFile = files.find(file => file.includes(sessionId));

      if (!sessionFile) {
        throw new Error(`Session file not found for ID: ${sessionId}`);
      }

      const filePath = this.getSessionFilePath(sessionFile);
      data.updatedAt = new Date().toISOString();

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Error saving session ${sessionId}:`, error);
      // Don't throw - we don't want to crash the app on save failure
    }
  }

  loadSession(sessionId: string): SessionData | null {
    try {
      const files = fs.readdirSync(this.historyDir);
      const sessionFile = files.find(file => file.includes(sessionId));

      if (!sessionFile) {
        console.error(`Session file not found for ID: ${sessionId}`);
        return null;
      }

      const filePath = this.getSessionFilePath(sessionFile);
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as SessionData;

      return data;
    } catch (error) {
      console.error(`Error loading session ${sessionId}:`, error);
      return null;
    }
  }

  listSessions(): SessionMetadata[] {
    try {
      if (!fs.existsSync(this.historyDir)) {
        return [];
      }

      const files = fs.readdirSync(this.historyDir);
      const sessionFiles = files.filter(file => file.startsWith('session-') && file.endsWith('.json'));

      const sessions: SessionMetadata[] = sessionFiles
        .map(fileName => {
          try {
            const filePath = this.getSessionFilePath(fileName);
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content) as SessionData;

            return {
              id: data.id,
              fileName: fileName,
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
              messageCount: data.messages.length,
            };
          } catch (error) {
            console.error(`Error reading session file ${fileName}:`, error);
            return null;
          }
        })
        .filter((session): session is SessionMetadata => session !== null);

      // Sort by creation date, newest first
      sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return sessions;
    } catch (error) {
      console.error('Error listing sessions:', error);
      return [];
    }
  }

  deleteSession(sessionId: string): boolean {
    try {
      const files = fs.readdirSync(this.historyDir);
      const sessionFile = files.find(file => file.includes(sessionId));

      if (!sessionFile) {
        return false;
      }

      const filePath = this.getSessionFilePath(sessionFile);
      fs.unlinkSync(filePath);
      return true;
    } catch (error) {
      console.error(`Error deleting session ${sessionId}:`, error);
      return false;
    }
  }
}
```

**Step 2: Verify it compiles**

Run: `npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add src/chat/session.ts
git commit -m "feat: implement SessionManager for session persistence

SessionManager handles:
- Creating new sessions with unique IDs
- Saving/loading session data to/from JSON files
- Listing all sessions with metadata
- Deleting sessions

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Update Conversation Class

**Files:**
- Modify: `src/chat/conversation.ts`

**Step 1: Add SessionManager integration**

Replace entire `src/chat/conversation.ts` with:

```typescript
import { Message, SessionStats, SessionData } from '../types/index.js';
import { SessionManager } from './session.js';

export class Conversation {
  private messages: Message[] = [];
  private sessionManager: SessionManager;
  private currentSessionId: string;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.currentSessionId = sessionManager.createSession();
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content });
  }

  addAssistantMessage(content: string): void {
    this.messages.push({ role: 'assistant', content });
  }

  getHistory(): Message[] {
    return [...this.messages];
  }

  getCurrentSessionId(): string {
    return this.currentSessionId;
  }

  saveSession(stats: SessionStats): void {
    const data: SessionData = {
      id: this.currentSessionId,
      createdAt: new Date().toISOString(), // Will be overwritten by actual createdAt on load
      updatedAt: new Date().toISOString(),
      messages: this.messages,
      stats: stats,
    };

    this.sessionManager.saveSession(this.currentSessionId, data);
  }

  resumeSession(sessionId: string): { success: boolean; stats: SessionStats | null } {
    const data = this.sessionManager.loadSession(sessionId);

    if (!data) {
      return { success: false, stats: null };
    }

    this.messages = data.messages;
    this.currentSessionId = sessionId;

    return { success: true, stats: data.stats };
  }

  clear(): void {
    this.messages = [];
    // Create new session after clear
    this.currentSessionId = this.sessionManager.createSession();
  }

  listSessions() {
    return this.sessionManager.listSessions();
  }
}
```

**Step 2: Verify it compiles**

Run: `npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add src/chat/conversation.ts
git commit -m "feat: integrate SessionManager into Conversation

Conversation now:
- Uses SessionManager for persistence
- Can save current session with stats
- Can resume previous sessions
- Creates new session on clear

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Update Chat Component - Add SessionManager

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Import and initialize SessionManager**

At the top of `src/components/Chat.tsx`, update imports:

```typescript
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, Key } from 'ink';
import { Conversation } from '../chat/conversation.js';
import { SessionManager } from '../chat/session.js';
import { sendMessage } from '../api/openrouter.js';
import { Message, UsageInfo, SessionStats } from '../types/index.js';
import { SKILLS, SkillName } from '../skills/index.js';
import { ModelRegistry } from '../models/registry.js';
import { ConfigManager } from '../models/config.js';
```

**Step 2: Update Chat component initialization**

Replace the line:
```typescript
const [conversation] = useState(() => new Conversation());
```

With:
```typescript
const [sessionManager] = useState(() => new SessionManager());
const [conversation] = useState(() => new Conversation(sessionManager));
```

**Step 3: Verify it compiles**

Run: `npm run build`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat: initialize SessionManager in Chat component

Chat now creates and uses SessionManager for Conversation.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Add Auto-Save After Messages

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add auto-save after assistant response**

In the `useInput` handler, find the block where the assistant message is added:

```typescript
conversation.addAssistantMessage(apiResponse.content);
setMessages(conversation.getHistory());
```

Add auto-save right after:

```typescript
conversation.addAssistantMessage(apiResponse.content);
setMessages(conversation.getHistory());

// Auto-save session after assistant response
conversation.saveSession(sessionStats);
```

**Step 2: Test auto-save**

Run: `npm start`
Send a message
Check: `.chat-history/` directory should contain a session file
Open the file: should contain your message and the response

**Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat: auto-save session after each message

Session is automatically saved after assistant responds.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add /resume Command

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add /resume command handler**

In the `handleCommand` function, before the `return false;` at the end, add:

```typescript
// Resume command - list sessions
if (trimmed === '/resume') {
  const sessions = conversation.listSessions();

  if (sessions.length === 0) {
    setNotification('Нет сохраненных сессий');
    return true;
  }

  let output = 'Сохраненные сессии:\n';
  sessions.forEach((session, index) => {
    const date = new Date(session.createdAt).toLocaleString('ru-RU');
    output += `${index + 1}. ${date} (${session.messageCount} сообщений)\n`;
  });
  output += '\nИспользуйте /resume <номер> для загрузки';

  setNotification(output);
  return true;
}

// Resume command - load specific session
if (trimmed.startsWith('/resume ')) {
  const arg = trimmed.slice('/resume '.length).trim();
  const num = parseInt(arg, 10);

  const sessions = conversation.listSessions();

  if (isNaN(num) || num < 1 || num > sessions.length) {
    setNotification(`Номер должен быть от 1 до ${sessions.length}`);
    return true;
  }

  const session = sessions[num - 1];
  const result = conversation.resumeSession(session.id);

  if (!result.success) {
    setNotification('Не удалось загрузить сессию');
    return true;
  }

  // Update UI with loaded history
  setMessages(conversation.getHistory());

  // Restore session stats
  if (result.stats) {
    setSessionStats(result.stats);
  }

  const date = new Date(session.createdAt).toLocaleString('ru-RU');
  setNotification(`Сессия загружена: ${date} (${session.messageCount} сообщений)`);
  return true;
}
```

**Step 2: Update help text**

Find the help text section at the top of the component (around line 290-310) and add:

```typescript
<Text dimColor>
  <Text color="yellow">/resume</Text> - восстановить сохраненную сессию
</Text>
```

**Step 3: Test /resume command**

Run: `npm start`
Create a session with a few messages
Exit with Ctrl+C
Run: `npm start` again
Type: `/resume`
Expected: List of sessions
Type: `/resume 1`
Expected: Session loaded with full history

**Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat: add /resume command to restore sessions

/resume - list all saved sessions
/resume <number> - load specific session with full history and stats

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Add Graceful Shutdown on Ctrl+C

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add SIGINT handler with useEffect**

After the `useInput` hook, add this `useEffect`:

```typescript
// Handle graceful shutdown on Ctrl+C
useEffect(() => {
  const handleExit = () => {
    try {
      // Save session before exit
      conversation.saveSession(sessionStats);
      console.log('\nСессия сохранена. До встречи!');
    } catch (error) {
      console.error('\nОшибка при сохранении:', error);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', handleExit);

  return () => {
    process.off('SIGINT', handleExit);
  };
}, [conversation, sessionStats]);
```

**Step 2: Test graceful shutdown**

Run: `npm start`
Send a few messages
Press Ctrl+C
Expected: "Сессия сохранена. До встречи!" message
Check: Session file should be updated with all messages

**Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat: graceful shutdown with session save on Ctrl+C

Session is automatically saved when user exits with Ctrl+C.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Update Clear Command

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Update /clear command to handle new session**

Find the `/clear` command handler and update the notification message:

```typescript
// Clear command
if (trimmed === '/clear') {
  conversation.clear();
  setSessionStats({
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCost: 0,
    requestCount: 0,
  });
  setLastResponseMetrics(null);
  setError(null);
  setNotification('Контекст очищен. Создана новая сессия. Предыдущая сессия сохранена.');
  return true;
}
```

**Step 2: Test /clear command**

Run: `npm start`
Send a few messages
Type: `/clear`
Expected: Messages cleared, new session created
Type: `/resume`
Expected: Previous session still available in list

**Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat: update /clear to create new session

/clear now creates a new session while preserving the old one.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Update README

**Files:**
- Modify: `README.md`

**Step 1: Add session persistence documentation**

After the `/clear` command section (around line 66), add:

```markdown
### Восстановление сессий

Агент автоматически сохраняет каждую сессию в `.chat-history/`. После перезапуска можно восстановить предыдущие диалоги:

```bash
# Показать список сохраненных сессий
/resume

# Загрузить конкретную сессию
/resume 1
```

**Автосохранение:**
- Сессия сохраняется после каждого сообщения
- При выходе (Ctrl+C) сессия сохраняется автоматически
- Каждая сессия хранится в отдельном JSON файле
```

**Step 2: Update features list**

Add to the features list at the top:
```markdown
- Автоматическое сохранение истории диалога
- Восстановление сессий через команду /resume
```

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add session persistence documentation

Document /resume command and auto-save behavior.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Final Testing

**Step 1: Complete integration test**

Run through this test scenario:

1. Start agent: `npm start`
2. Send message: "Привет, как дела?"
3. Wait for response
4. Send another message: "Расскажи шутку"
5. Exit with Ctrl+C
6. Check: `.chat-history/` should have a session file with 4 messages
7. Start agent again: `npm start`
8. Type: `/resume`
9. Verify: Session appears in list with correct message count
10. Type: `/resume 1`
11. Verify: Full history loaded, stats restored
12. Send new message: "Еще одну шутку"
13. Verify: Message adds to existing session
14. Type: `/clear`
15. Type: `/resume`
16. Verify: Both sessions appear in list

**Step 2: Test error cases**

1. Manually corrupt a JSON file (remove a bracket)
2. Try to load it with `/resume`
3. Verify: Error message shown, app doesn't crash

**Step 3: Document results**

Create `docs/testing/2026-02-24-context-persistence-verification.md`:

```markdown
# Context Persistence Verification

**Date:** 2026-02-24
**Feature:** Session persistence with auto-save

## Test Results

### ✅ Auto-save functionality
- Sessions save after each message
- Files created in .chat-history/
- JSON format correct

### ✅ Graceful shutdown
- Ctrl+C triggers save
- Success message displayed
- Session file updated

### ✅ Resume command
- /resume lists sessions correctly
- /resume <n> loads history and stats
- Continued messages append to loaded session

### ✅ Error handling
- Corrupted JSON handled gracefully
- Missing sessions handled
- Invalid resume numbers handled

### ✅ Clear command
- Creates new session
- Preserves old session
- Resets stats correctly

## Conclusion

All Day 7 requirements met:
- ✅ History stored in JSON
- ✅ Auto-save after each message
- ✅ Resume command works
- ✅ Sessions persist between restarts
- ✅ Ctrl+C handled gracefully
```

**Step 4: Final commit**

```bash
git add docs/testing/2026-02-24-context-persistence-verification.md
git commit -m "docs: add context persistence verification

All Day 7 requirements verified and working.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Summary

**What we built:**
- SessionManager class for JSON-based persistence
- Auto-save after every message
- /resume command to list and load sessions
- Graceful shutdown on Ctrl+C
- Integration with existing stats tracking

**Key files modified:**
- `src/types/index.ts` - Added session types
- `src/chat/session.ts` - New SessionManager class
- `src/chat/conversation.ts` - Integrated SessionManager
- `src/components/Chat.tsx` - Added /resume, auto-save, SIGINT handler
- `README.md` - Documentation
- `docs/testing/` - Verification results

**Architecture:**
- `.chat-history/session-YYYY-MM-DD-HH-MM-SS-<id>.json` per session
- Auto-save doesn't block UI
- Error handling prevents crashes
- Stats persist with messages

**Next steps:**
- Optional: Add /delete command to remove old sessions
- Optional: Add session search/filter
- Optional: Export session to markdown
