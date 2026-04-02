# Task State Machine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Task State Machine for stateful agent with formal task states (planning → execution → validation → done)

**Architecture:** Create taskstate module with TaskStateMachine class managing states, transitions, and persistence. Integrate with existing MemoryManager and Session systems via prompt injection. State stored in `.task-state/` directory.

**Tech Stack:** TypeScript, Node.js fs module for persistence, existing Ink UI components

---

## Task 1: Create TaskState types and constants

**Files:**
- Create: `src/taskstate/types.ts`

**Step 1: Write the type definitions**

```typescript
/**
 * Task state enum - represents the current stage of task execution
 */
export enum TaskState {
  PLANNING = 'planning',
  EXECUTION = 'execution',
  VALIDATION = 'validation',
  DONE = 'done',
}

/**
 * State transition record
 */
export interface StateTransition {
  from: TaskState | 'START';
  to: TaskState;
  timestamp: string;
  reason?: string;
}

/**
 * Task context - complete state of a task
 */
export interface TaskContext {
  taskId: string;
  description: string;
  currentState: TaskState;
  startedAt: string;
  updatedAt: string;
  stateHistory: StateTransition[];
  planContent?: string;
  executionResult?: string;
  validationResult?: string;
}

/**
 * Allowed state transitions map
 */
export const ALLOWED_TRANSITIONS: Record<TaskState, TaskState[]> = {
  [TaskState.PLANNING]: [TaskState.EXECUTION],
  [TaskState.EXECUTION]: [TaskState.PLANNING, TaskState.VALIDATION],
  [TaskState.VALIDATION]: [TaskState.EXECUTION, TaskState.DONE],
  [TaskState.DONE]: [],
};

/**
 * State emoji indicators for UI
 */
export const STATE_INDICATORS: Record<TaskState, string> = {
  [TaskState.PLANNING]: '🟡',
  [TaskState.EXECUTION]: '🔵',
  [TaskState.VALIDATION]: '🟠',
  [TaskState.DONE]: '🟢',
};

/**
 * State instructions for prompt injection
 */
export const STATE_INSTRUCTIONS: Record<TaskState, string> = {
  [TaskState.PLANNING]: 'Задавай уточняющие вопросы пользователю, составь детальный план. НЕ начинай выполнение до утверждения плана.',
  [TaskState.EXECUTION]: 'Реализуй утвержденный план. Придерживайся плана, не делай лишних изменений. Сообщи о завершении.',
  [TaskState.VALIDATION]: 'Проверь результат выполнения. Предложи тесты, найди проблемы, рекомендуй улучшения.',
  [TaskState.DONE]: 'Задача завершена. Подведи итоги и покажи финальный результат.',
};
```

**Step 2: Commit**

```bash
git add src/taskstate/types.ts
git commit -m "feat(taskstate): add TaskState types and constants"
```

---

## Task 2: Create TaskStateMachine class

**Files:**
- Create: `src/taskstate/TaskStateMachine.ts`

**Step 1: Write TaskStateMachine class skeleton**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  TaskState,
  TaskContext,
  StateTransition,
  ALLOWED_TRANSITIONS,
  STATE_INDICATORS,
  STATE_INSTRUCTIONS,
} from './types.js';

export class TaskStateMachine {
  private currentTask: TaskContext | null = null;
  private stateDir: string;

  constructor(stateDir: string = '.task-state') {
    this.stateDir = stateDir;
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }

  private generateTaskId(): string {
    return crypto.randomBytes(6).toString('hex');
  }

  private getTaskFilePath(taskId: string): string {
    return path.join(this.stateDir, `${taskId}.json`);
  }

  /**
   * Create a new task in PLANNING state
   */
  createTask(description: string): TaskContext {
    const taskId = this.generateTaskId();
    const now = new Date().toISOString();

    const task: TaskContext = {
      taskId,
      description,
      currentState: TaskState.PLANNING,
      startedAt: now,
      updatedAt: now,
      stateHistory: [
        {
          from: 'START',
          to: TaskState.PLANNING,
          timestamp: now,
        },
      ],
    };

    this.currentTask = task;
    this.save();
    return task;
  }

  /**
   * Attempt to transition to a new state
   * Returns true if transition is allowed and successful
   */
  transition(nextState: TaskState, reason?: string): boolean {
    if (!this.currentTask) {
      throw new Error('No active task');
    }

    const currentState = this.currentTask.currentState;
    const allowedStates = ALLOWED_TRANSITIONS[currentState];

    if (!allowedStates.includes(nextState)) {
      return false;
    }

    const now = new Date().toISOString();
    const transition: StateTransition = {
      from: currentState,
      to: nextState,
      timestamp: now,
      reason,
    };

    this.currentTask.currentState = nextState;
    this.currentTask.updatedAt = now;
    this.currentTask.stateHistory.push(transition);

    this.save();
    return true;
  }

  /**
   * Save current task to disk
   */
  private save(): void {
    if (!this.currentTask) return;

    const filePath = this.getTaskFilePath(this.currentTask.taskId);
    fs.writeFileSync(filePath, JSON.stringify(this.currentTask, null, 2), 'utf-8');
  }

  /**
   * Load task from disk
   */
  load(taskId: string): boolean {
    const filePath = this.getTaskFilePath(taskId);

    if (!fs.existsSync(filePath)) {
      return false;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    this.currentTask = JSON.parse(content) as TaskContext;
    return true;
  }

  /**
   * Get current task context
   */
  getCurrentTask(): TaskContext | null {
    return this.currentTask;
  }

  /**
   * Get prompt injection for current state
   */
  getStatePrompt(): string {
    if (!this.currentTask) {
      return '';
    }

    const state = this.currentTask.currentState;
    const indicator = STATE_INDICATORS[state];
    const instruction = STATE_INSTRUCTIONS[state];
    const history = this.currentTask.stateHistory
      .map((t) => `${t.from} → ${t.to}`)
      .join(' → ');

    return `
=== ТЕКУЩЕЕ СОСТОЯНИЕ ЗАДАЧИ ===
Задача: ${this.currentTask.description}
Текущий этап: ${state.toUpperCase()} ${indicator}
Что делать: ${instruction}
История переходов: ${history}
===
`;
  }

  /**
   * List all task files
   */
  listTasks(): Array<{ taskId: string; description: string; state: TaskState; updatedAt: string }> {
    if (!fs.existsSync(this.stateDir)) {
      return [];
    }

    const files = fs.readdirSync(this.stateDir).filter((f) => f.endsWith('.json'));

    return files
      .map((fileName) => {
        try {
          const filePath = path.join(this.stateDir, fileName);
          const content = fs.readFileSync(filePath, 'utf-8');
          const task = JSON.parse(content) as TaskContext;

          return {
            taskId: task.taskId,
            description: task.description,
            state: task.currentState,
            updatedAt: task.updatedAt,
          };
        } catch {
          return null;
        }
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  /**
   * Update task stage content (plan, execution result, validation)
   */
  updateStageContent(stage: 'plan' | 'execution' | 'validation', content: string): void {
    if (!this.currentTask) return;

    switch (stage) {
      case 'plan':
        this.currentTask.planContent = content;
        break;
      case 'execution':
        this.currentTask.executionResult = content;
        break;
      case 'validation':
        this.currentTask.validationResult = content;
        break;
    }

    this.currentTask.updatedAt = new Date().toISOString();
    this.save();
  }

  /**
   * Clear current task (without deleting file)
   */
  clearCurrent(): void {
    this.currentTask = null;
  }
}
```

**Step 2: Commit**

```bash
git add src/taskstate/TaskStateMachine.ts
git commit -m "feat(taskstate): implement TaskStateMachine class"
```

---

## Task 3: Create taskstate module exports

**Files:**
- Create: `src/taskstate/index.ts`

**Step 1: Write exports**

```typescript
export * from './types.js';
export { TaskStateMachine } from './TaskStateMachine.js';
```

**Step 2: Commit**

```bash
git add src/taskstate/index.ts
git commit -m "feat(taskstate): add module exports"
```

---

## Task 4: Integrate TaskStateMachine with MemoryManager

**Files:**
- Modify: `src/memory/MemoryManager.ts`

**Step 1: Add TaskStateMachine property**

```typescript
// Add import at top
import { TaskStateMachine } from '../taskstate/index.js';

// Inside MemoryManager class, add property
export class MemoryManager {
  private shortTerm: ShortTermMemory;
  private working: WorkingMemory;
  private longTerm: LongTermMemory;
  private profileManager: ProfileManager;
  private taskStateMachine: TaskStateMachine; // ← Add this

  constructor(baseDir: string = '.memory') {
    this.shortTerm = new ShortTermMemory(`${baseDir}/short-term`);
    this.working = new WorkingMemory(`${baseDir}/working`);
    this.longTerm = new LongTermMemory(`${baseDir}/long-term`);
    this.profileManager = new ProfileManager(`${baseDir}/profiles`);
    this.taskStateMachine = new TaskStateMachine('.task-state'); // ← Add this
  }

  // Add getter
  getTaskStateMachine(): TaskStateMachine {
    return this.taskStateMachine;
  }
}
```

**Step 2: Commit**

```bash
git add src/memory/MemoryManager.ts
git commit -m "feat(memory): integrate TaskStateMachine into MemoryManager"
```

---

## Task 5: Add task state prompt injection to Conversation

**Files:**
- Modify: `src/chat/conversation.ts`

**Step 1: Update buildSystemPromptWithMemory method**

Find the `buildSystemPromptWithMemory` method around line 169 and add task state prompt injection after profile section:

```typescript
buildSystemPromptWithMemory(basePrompt?: string): string {
  const context = this.memoryManager.getContextForPrompt();
  const profile = this.memoryManager.getProfileManager().getActiveProfile();
  let prompt = basePrompt || 'Ты полезный AI ассистент.\n\n';

  // Add profile personalization (existing code stays)
  if (profile) {
    // ... existing profile code ...
  }

  // Add profile from memory context (existing code stays)
  if (context.longTerm.profile.preferences.stack.length > 0) {
    // ... existing legacy profile code ...
  }

  // ← ADD THIS: Task state prompt injection
  const taskStatePrompt = this.memoryManager.getTaskStateMachine().getStatePrompt();
  if (taskStatePrompt) {
    prompt += taskStatePrompt + '\n';
  }

  // Add constraints (existing code stays)
  const constraints = context.longTerm.constraints;
  // ... rest of existing code ...

  return prompt;
}
```

**Step 2: Commit**

```bash
git add src/chat/conversation.ts
git commit -m "feat(conversation): inject task state into system prompt"
```

---

## Task 6: Add taskStateId to SessionData type

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Update SessionData interface**

Find the `SessionData` interface around line 160 and add `taskStateId` field:

```typescript
export interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  summary?: string;
  needsSummarization?: boolean;
  stats: SessionStats;
  strategyState?: StrategyState;
  taskStateId?: string; // ← Add this
}
```

**Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add taskStateId to SessionData"
```

---

## Task 7: Link session with task state in Conversation

**Files:**
- Modify: `src/chat/conversation.ts`

**Step 1: Update saveSession to include taskStateId**

Find the `saveSession` method around line 83 and add taskStateId:

```typescript
saveSession(stats: SessionStats): void {
  const currentTask = this.memoryManager.getTaskStateMachine().getCurrentTask();

  const data: SessionData = {
    id: this.currentSessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: this.messages,
    summary: this.summary ?? undefined,
    needsSummarization: this.needsSummarizationFlag,
    stats: stats,
    strategyState: this.strategy.serialize(),
    taskStateId: currentTask?.taskId, // ← Add this
  };

  this.sessionManager.saveSession(this.currentSessionId, data);
}
```

**Step 2: Update resumeSession to restore task state**

Find the `resumeSession` method around line 98 and add task state restoration:

```typescript
resumeSession(sessionId: string): { success: boolean; stats: SessionStats | null } {
  const data = this.sessionManager.loadSession(sessionId);

  if (!data) {
    return { success: false, stats: null };
  }

  this.messages = data.messages;
  this.allMessages = [...data.messages];
  this.currentSessionId = sessionId;
  this.summary = data.summary ?? null;
  this.needsSummarizationFlag = data.needsSummarization ?? false;

  // Restore strategy if available
  if (data.strategyState) {
    this.strategy = this.createStrategyFromState(data.strategyState);
  }

  // ← ADD THIS: Restore task state
  if (data.taskStateId) {
    this.memoryManager.getTaskStateMachine().load(data.taskStateId);
  }

  return { success: true, stats: data.stats };
}
```

**Step 3: Commit**

```bash
git add src/chat/conversation.ts
git commit -m "feat(conversation): link session with task state"
```

---

## Task 8: Update SessionMetadata to show task state

**Files:**
- Modify: `src/types/index.ts`

**Step 1: Add task state to SessionMetadata**

```typescript
export interface SessionMetadata {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  taskState?: string; // ← Add this
  taskDescription?: string; // ← Add this
}
```

**Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add task state to SessionMetadata"
```

---

## Task 9: Update SessionManager to include task info in listSessions

**Files:**
- Modify: `src/chat/session.ts`

**Step 1: Update listSessions to read task state**

Find the `listSessions` method around line 108 and update the mapping:

```typescript
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

          let taskState: string | undefined;
          let taskDescription: string | undefined;

          // ← ADD THIS: Read task state if available
          if (data.taskStateId) {
            try {
              const taskPath = path.join('.task-state', `${data.taskStateId}.json`);
              if (fs.existsSync(taskPath)) {
                const taskContent = fs.readFileSync(taskPath, 'utf-8');
                const task = JSON.parse(taskContent);
                taskState = task.currentState;
                taskDescription = task.description;
              }
            } catch {
              // Ignore task read errors
            }
          }

          return {
            id: data.id,
            fileName: fileName,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            messageCount: data.messages.length,
            taskState,
            taskDescription,
          };
        } catch (error) {
          console.error(`Error reading session file ${fileName}:`, error);
          return null;
        }
      })
      .filter((session): session is SessionMetadata => session !== null);

    sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return sessions;
  } catch (error) {
    console.error('Error listing sessions:', error);
    return [];
  }
}
```

**Step 2: Add path import at top**

```typescript
import * as path from 'path';
```

**Step 3: Commit**

```bash
git add src/chat/session.ts
git commit -m "feat(session): include task state in session listing"
```

---

## Task 10: Add task state indicator to Chat UI

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Read Chat.tsx to understand structure**

Run: `head -150 src/components/Chat.tsx` to see component structure

Expected: See state declarations and rendering logic

**Step 2: Add task state display**

After reading the file, add task state indicator in the appropriate section of the render method. Look for where the input prompt is rendered and add state indicator before it.

Add near the input rendering section:

```typescript
// Add this helper function near the top of the component
function getTaskStateDisplay(conversation: Conversation): string {
  const taskMachine = conversation.getMemoryManager().getTaskStateMachine();
  const task = taskMachine.getCurrentTask();

  if (!task) return '';

  const indicator = STATE_INDICATORS[task.currentState];
  return `[State: ${task.currentState.toUpperCase()}] ${indicator}`;
}

// Then in the render, before the input, add:
{getTaskStateDisplay(conversation) && (
  <Text color="cyan">
    {getTaskStateDisplay(conversation)}
  </Text>
)}
```

**Step 3: Add import for STATE_INDICATORS**

```typescript
import { STATE_INDICATORS } from '../taskstate/index.js';
```

**Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(ui): add task state indicator to Chat UI"
```

---

## Task 11: Add /task commands to Chat

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add task command handlers**

Find where other commands like `/clear`, `/model`, `/resume` are handled. Add new handlers:

```typescript
// In the command handling section, add:

if (input.startsWith('/task')) {
  const args = input.slice(6).trim();

  // /task (show current task)
  if (!args) {
    const task = conversation.getMemoryManager().getTaskStateMachine().getCurrentTask();
    if (!task) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '📋 Нет активной задачи. Начните новую задачу, отправив сообщение.' },
      ]);
    } else {
      const indicator = STATE_INDICATORS[task.currentState];
      const history = task.stateHistory.map(t => `${t.from} → ${t.to}`).join(' → ');
      const created = new Date(task.startedAt).toLocaleString('ru-RU');

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `📋 Текущая задача:\nОписание: ${task.description}\nСостояние: ${task.currentState.toUpperCase()} ${indicator}\nСоздана: ${created}\nИстория: ${history}`,
        },
      ]);
    }
    setInput('');
    return;
  }

  // /task new <description>
  if (args.startsWith('new ')) {
    const description = args.slice(4).trim();
    if (!description) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '❌ Укажите описание задачи: /task new <описание>' },
      ]);
      setInput('');
      return;
    }

    const taskMachine = conversation.getMemoryManager().getTaskStateMachine();
    const task = taskMachine.createTask(description);

    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: `✅ Создана новая задача [ID: ${task.taskId}]\nОписание: ${description}\nСостояние: PLANNING 🟡`,
      },
    ]);
    setInput('');
    return;
  }

  // /task list
  if (args === 'list') {
    const tasks = conversation.getMemoryManager().getTaskStateMachine().listTasks();

    if (tasks.length === 0) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '📋 Нет сохраненных задач.' },
      ]);
    } else {
      const taskList = tasks.map((t, idx) => {
        const indicator = STATE_INDICATORS[t.state];
        const updated = new Date(t.updatedAt).toLocaleString('ru-RU');
        return `${idx + 1}. ${t.description.slice(0, 50)}${t.description.length > 50 ? '...' : ''} [${t.state.toUpperCase()} ${indicator}] - ${updated}`;
      }).join('\n');

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `📋 Задачи:\n${taskList}` },
      ]);
    }
    setInput('');
    return;
  }

  // /task load <number>
  if (args.startsWith('load ')) {
    const numStr = args.slice(5).trim();
    const num = parseInt(numStr, 10);

    if (isNaN(num) || num < 1) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '❌ Укажите номер задачи: /task load <номер>' },
      ]);
      setInput('');
      return;
    }

    const tasks = conversation.getMemoryManager().getTaskStateMachine().listTasks();
    if (num > tasks.length) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `❌ Задача #${num} не найдена. Всего задач: ${tasks.length}` },
      ]);
      setInput('');
      return;
    }

    const task = tasks[num - 1];
    const loaded = conversation.getMemoryManager().getTaskStateMachine().load(task.taskId);

    if (loaded) {
      const indicator = STATE_INDICATORS[task.state];
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `✅ Загружена задача: ${task.description}\nСостояние: ${task.state.toUpperCase()} ${indicator}\nПродолжаем работу...`,
        },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '❌ Не удалось загрузить задачу' },
      ]);
    }
    setInput('');
    return;
  }
}
```

**Step 2: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(commands): add /task commands (show/new/list/load)"
```

---

## Task 12: Add /next command for manual state transitions

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add /next command handler**

In the command handling section, add:

```typescript
if (input === '/next') {
  const taskMachine = conversation.getMemoryManager().getTaskStateMachine();
  const task = taskMachine.getCurrentTask();

  if (!task) {
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '❌ Нет активной задачи' },
    ]);
    setInput('');
    return;
  }

  const currentState = task.currentState;
  const allowedStates = ALLOWED_TRANSITIONS[currentState];

  if (allowedStates.length === 0) {
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '✅ Задача уже в финальном состоянии DONE 🟢' },
    ]);
    setInput('');
    return;
  }

  // Transition to first allowed state
  const nextState = allowedStates[0];
  const success = taskMachine.transition(nextState, 'Manual transition via /next');

  if (success) {
    const indicator = STATE_INDICATORS[nextState];
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: `✅ Переход: ${currentState.toUpperCase()} → ${nextState.toUpperCase()} ${indicator}\n${STATE_INSTRUCTIONS[nextState]}`,
      },
    ]);
  } else {
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', content: '❌ Не удалось выполнить переход' },
    ]);
  }

  setInput('');
  return;
}
```

**Step 2: Add import for ALLOWED_TRANSITIONS and STATE_INSTRUCTIONS**

```typescript
import { STATE_INDICATORS, ALLOWED_TRANSITIONS, STATE_INSTRUCTIONS } from '../taskstate/index.js';
```

**Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(commands): add /next command for manual state transitions"
```

---

## Task 13: Auto-create task on first user message

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add task auto-creation logic**

In the message sending logic (where `sendMessage` is called), add check before sending:

```typescript
// Before calling sendMessage, add:
const taskMachine = conversation.getMemoryManager().getTaskStateMachine();
let currentTask = taskMachine.getCurrentTask();

// Auto-create task if none exists
if (!currentTask && !input.startsWith('/')) {
  currentTask = taskMachine.createTask(input);
  setMessages((prev) => [
    ...prev,
    {
      role: 'assistant',
      content: `📋 Создана новая задача\nСостояние: PLANNING 🟡\nНачинаем планирование...`,
    },
  ]);
}
```

**Step 2: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): auto-create task on first user message"
```

---

## Task 14: Update /resume to show task state

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Find /resume command handler**

Look for where `/resume` command displays session list

**Step 2: Update session display to include task state**

Modify the session listing to show task state:

```typescript
// In /resume command, update the session list display:
if (input === '/resume') {
  const sessions = conversation.listSessions();

  if (sessions.length === 0) {
    // ... existing empty case
  } else {
    const sessionList = sessions.map((s, idx) => {
      const date = new Date(s.createdAt).toLocaleString('ru-RU');
      const updated = new Date(s.updatedAt).toLocaleString('ru-RU');

      // ← ADD THIS: Show task state if available
      let taskInfo = '';
      if (s.taskState && s.taskDescription) {
        const indicator = STATE_INDICATORS[s.taskState as TaskState];
        taskInfo = ` [${s.taskState.toUpperCase()} ${indicator}]`;
      }

      return `${idx + 1}. Session ${s.id}${taskInfo} - ${s.messageCount} messages\n   Создана: ${date}\n   Обновлена: ${updated}`;
    }).join('\n\n');

    // ... rest of existing code
  }
}
```

**Step 3: Add TaskState import**

```typescript
import { TaskState } from '../taskstate/index.js';
```

**Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(resume): show task state in session list"
```

---

## Task 15: Test pause and resume with state preservation

**Files:**
- Test: Manual testing via `npm start`

**Step 1: Test basic task creation**

Run: `npm start`

Interact:
```
> Напиши REST API для управления задачами
```

Expected:
- See "Создана новая задача"
- See "[State: PLANNING] 🟡" indicator
- Agent asks questions in planning mode

**Step 2: Test pause (Ctrl+C)**

Action: Press `Ctrl+C` to exit

Expected: Session saved with task state

**Step 3: Test resume**

Run: `npm start`

Interact:
```
> /resume
> /resume 1
```

Expected:
- Session list shows task state `[PLANNING 🟡]`
- After resume, state indicator appears
- Agent continues in PLANNING without re-asking initial questions

**Step 4: Test state transition**

Interact:
```
> Утверждаю план
```

Expected:
- Transition to EXECUTION
- Indicator changes to `[State: EXECUTION] 🔵`

**Step 5: Test /next command**

Interact:
```
> /next
```

Expected:
- Transition to next allowed state
- Shows new state and instructions

**Step 6: Document test results**

Create: `docs/testing/2026-03-04-task-state-machine-verification.md`

Document:
- All test scenarios
- Screenshots if possible
- Any bugs found

**Step 7: Commit test documentation**

```bash
git add -f docs/testing/2026-03-04-task-state-machine-verification.md
git commit -m "test: add Task State Machine verification results"
```

---

## Task 16: Final integration testing

**Files:**
- Test: All task state features

**Step 1: Test complete workflow**

Run: `npm start`

Scenario:
1. Create task (auto or via `/task new`)
2. Go through PLANNING → EXECUTION → VALIDATION → DONE
3. Test pause/resume at each stage
4. Test `/task` commands (show, list, load)
5. Test multiple tasks

**Step 2: Verify prompt injection**

Check that system prompt includes task state block at each stage

Expected: Task state instructions appear in agent responses

**Step 3: Test edge cases**

- Resume without task state (should work normally)
- Invalid transitions (should be blocked)
- Empty task list
- Task file corruption

**Step 4: Commit final fixes**

```bash
git add <any-fixed-files>
git commit -m "fix: handle edge cases in task state machine"
```

---

## Task 17: Update README with task state features

**Files:**
- Modify: `README.md`

**Step 1: Add Task State Machine section**

Add after "Управление профилями" section:

```markdown
## Task State Machine

Агент поддерживает формализованное состояние задачи с автоматическим управлением этапами выполнения.

### Состояния задачи

- **PLANNING 🟡** — планирование задачи (вопросы, составление плана)
- **EXECUTION 🔵** — выполнение утвержденного плана
- **VALIDATION 🟠** — проверка результата, тестирование
- **DONE 🟢** — задача завершена

### Автоматическое создание задачи

При первом сообщении автоматически создается задача в состоянии PLANNING.

### Команды управления задачами

- `/task` - показать текущую задачу
- `/task new <описание>` - создать новую задачу
- `/task list` - список всех задач
- `/task load <номер>` - загрузить задачу
- `/next` - перейти к следующему этапу

### Пример использования

```bash
npm start

# Создание задачи
> Напиши сервис авторизации
[State: PLANNING] 🟡
# Агент задает вопросы...

# Пауза
Ctrl+C

# Восстановление
npm start
/resume 1
[State: PLANNING] 🟡
# Продолжение без повторных вопросов

# Переход к следующему этапу
> Утверждаю план
[State: EXECUTION] 🔵
# Агент начинает реализацию
```

### Переходы между состояниями

- PLANNING → EXECUTION (план утвержден)
- EXECUTION → VALIDATION (код готов)
- EXECUTION → PLANNING (нужны изменения в плане)
- VALIDATION → EXECUTION (найдены проблемы)
- VALIDATION → DONE (все работает)
```

**Step 2: Commit README update**

```bash
git add README.md
git commit -m "docs: add Task State Machine documentation to README"
```

---

## Task 18: Create final summary commit

**Files:**
- All modified files

**Step 1: Review all changes**

Run: `git log --oneline -20`

Expected: See all commits from this implementation

**Step 2: Create summary commit**

```bash
git commit --allow-empty -m "feat: complete Task State Machine implementation

Implemented stateful agent with formal task states:
- TaskStateMachine class with state management
- Integration with MemoryManager and Session
- Task state persistence in .task-state/ directory
- UI indicators showing current state
- Commands: /task, /task new, /task list, /task load, /next
- Auto-creation of tasks on first message
- Pause/resume with state preservation
- State transitions: PLANNING → EXECUTION → VALIDATION → DONE

Closes Day 13 requirement for formalized task state."
```

---

## Verification Checklist

After completing all tasks, verify:

- ✅ Task states defined (PLANNING, EXECUTION, VALIDATION, DONE)
- ✅ State transitions with validation (allowed transitions only)
- ✅ Persistence in .task-state/ directory
- ✅ Integration with MemoryManager
- ✅ Prompt injection shows current state
- ✅ Session links to task state (taskStateId)
- ✅ UI shows state indicator
- ✅ Commands: /task, /task new, /task list, /task load, /next
- ✅ Auto-create task on first message
- ✅ Pause and resume preserves state
- ✅ Agent doesn't repeat questions after resume
- ✅ README documentation updated

---

## Notes

**DRY Principles:**
- TaskStateMachine is reusable across projects
- State logic centralized in one class
- Types shared across modules

**YAGNI:**
- No over-engineering with complex state machines
- Simple 4-state workflow sufficient for requirements
- No unnecessary features like state timeouts or rollback

**Testing:**
- Manual testing sufficient for MVP
- Focus on pause/resume workflow
- Verify state preservation across restarts

**Integration:**
- Minimal changes to existing code
- Prompt injection pattern reused from profiles
- Session linking pattern consistent with existing design
