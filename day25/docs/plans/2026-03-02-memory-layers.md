# Memory Layers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement explicit memory model with three layers (short-term, working, long-term) for the CLI agent with manual control through commands.

**Architecture:** Create modular memory system with MemoryManager coordinating three specialized classes (ShortTermMemory, WorkingMemory, LongTermMemory). Each layer stores data in separate JSON files under `.memory/` directory. Memory context is injected into System Prompt before API calls.

**Tech Stack:** TypeScript, Node.js fs/promises, existing Conversation class integration

---

## Task 1: Create memory types and interfaces

**Files:**
- Create: `src/memory/types.ts`

**Step 1: Write the failing test**

```typescript
// tests/memory/types.test.ts
import { MemoryContext, Task, Profile, Constraints, Fact } from '../src/memory/types.js';

describe('Memory Types', () => {
  test('should create valid MemoryContext', () => {
    const context: MemoryContext = {
      shortTerm: [],
      working: null,
      longTerm: {
        profile: {
          style: { responseLength: 'detailed', tone: 'professional', language: 'russian' },
          preferences: { stack: ['TypeScript'], frameworks: [] }
        },
        constraints: { forbidden: [], required: [], rules: [] },
        knowledge: []
      }
    };

    expect(context.longTerm.profile.style.language).toBe('russian');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/memory/types.test.ts`
Expected: FAIL with "Cannot find module '../src/memory/types.js'"

**Step 3: Create types file**

```typescript
// src/memory/types.ts
import { Message } from '../types/index.js';

export interface MemoryContext {
  shortTerm: Message[];
  working: Task | null;
  longTerm: {
    profile: Profile;
    constraints: Constraints;
    knowledge: Fact[];
  };
}

export interface Task {
  taskId: string;
  description: string;
  status: 'in_progress' | 'completed';
  context: Record<string, any>;
  startedAt: string;
}

export interface Profile {
  style: {
    responseLength: string;
    tone: string;
    language: string;
  };
  preferences: {
    stack: string[];
    frameworks: string[];
  };
}

export interface Constraints {
  forbidden: string[];
  required: string[];
  rules: string[];
}

export interface Fact {
  id: string;
  content: string;
  addedAt: string;
  relevance: 'high' | 'medium' | 'low';
}

export interface Knowledge {
  facts: Fact[];
  decisions: Decision[];
}

export interface Decision {
  id: string;
  content: string;
  madeAt: string;
  rationale: string;
}

export interface SessionData {
  sessionId: string;
  startedAt: string;
  messages: Message[];
  tokenCount: number;
}

export type MemoryLayer = 'short' | 'working' | 'long';
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/memory/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory/types.ts tests/memory/types.test.ts
git commit -m "feat(memory): add memory layer types and interfaces"
```

---

## Task 2: Implement ShortTermMemory class

**Files:**
- Create: `src/memory/ShortTermMemory.ts`
- Test: `tests/memory/ShortTermMemory.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/memory/ShortTermMemory.test.ts
import { ShortTermMemory } from '../src/memory/ShortTermMemory.js';
import { Message } from '../src/types/index.js';
import fs from 'fs/promises';
import path from 'path';

describe('ShortTermMemory', () => {
  const testDir = '.memory-test/short-term';
  let memory: ShortTermMemory;

  beforeEach(async () => {
    memory = new ShortTermMemory(testDir);
    await memory.initialize();
  });

  afterEach(async () => {
    await fs.rm('.memory-test', { recursive: true, force: true });
  });

  test('should add message to session', () => {
    const message: Message = { role: 'user', content: 'Test' };
    memory.addMessage(message);

    const messages = memory.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Test');
  });

  test('should save and load session', async () => {
    const message: Message = { role: 'user', content: 'Test' };
    memory.addMessage(message);
    await memory.save();

    const newMemory = new ShortTermMemory(testDir);
    await newMemory.load();

    expect(newMemory.getMessages()).toHaveLength(1);
  });

  test('should clear session', () => {
    memory.addMessage({ role: 'user', content: 'Test' });
    memory.clear();

    expect(memory.getMessages()).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/memory/ShortTermMemory.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Implement ShortTermMemory**

```typescript
// src/memory/ShortTermMemory.ts
import fs from 'fs/promises';
import path from 'path';
import { Message } from '../types/index.js';
import { SessionData } from './types.js';

export class ShortTermMemory {
  private sessionFile: string;
  private session: SessionData;

  constructor(baseDir: string = '.memory/short-term') {
    this.sessionFile = path.join(baseDir, 'current-session.json');
    this.session = {
      sessionId: this.generateSessionId(),
      startedAt: new Date().toISOString(),
      messages: [],
      tokenCount: 0,
    };
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.sessionFile);
    await fs.mkdir(dir, { recursive: true });
  }

  addMessage(message: Message): void {
    this.session.messages.push(message);
  }

  getMessages(): Message[] {
    return [...this.session.messages];
  }

  clear(): void {
    this.session = {
      sessionId: this.generateSessionId(),
      startedAt: new Date().toISOString(),
      messages: [],
      tokenCount: 0,
    };
  }

  async save(): Promise<void> {
    await fs.writeFile(this.sessionFile, JSON.stringify(this.session, null, 2), 'utf-8');
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.sessionFile, 'utf-8');
      this.session = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet, keep default session
    }
  }

  private generateSessionId(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/memory/ShortTermMemory.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory/ShortTermMemory.ts tests/memory/ShortTermMemory.test.ts
git commit -m "feat(memory): implement ShortTermMemory for session management"
```

---

## Task 3: Implement WorkingMemory class

**Files:**
- Create: `src/memory/WorkingMemory.ts`
- Test: `tests/memory/WorkingMemory.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/memory/WorkingMemory.test.ts
import { WorkingMemory } from '../src/memory/WorkingMemory.js';
import { Task } from '../src/memory/types.js';
import fs from 'fs/promises';

describe('WorkingMemory', () => {
  const testDir = '.memory-test/working';
  let memory: WorkingMemory;

  beforeEach(async () => {
    memory = new WorkingMemory(testDir);
    await memory.initialize();
  });

  afterEach(async () => {
    await fs.rm('.memory-test', { recursive: true, force: true });
  });

  test('should set and get active task', async () => {
    const task: Task = {
      taskId: 'task-1',
      description: 'Test task',
      status: 'in_progress',
      context: {},
      startedAt: new Date().toISOString(),
    };

    await memory.setTask(task);
    const retrieved = memory.getTask();

    expect(retrieved?.description).toBe('Test task');
  });

  test('should add context to task', async () => {
    const task: Task = {
      taskId: 'task-1',
      description: 'Test',
      status: 'in_progress',
      context: {},
      startedAt: new Date().toISOString(),
    };

    await memory.setTask(task);
    await memory.addContext('files', ['test.ts']);

    const retrieved = memory.getTask();
    expect(retrieved?.context.files).toEqual(['test.ts']);
  });

  test('should complete task', async () => {
    const task: Task = {
      taskId: 'task-1',
      description: 'Test',
      status: 'in_progress',
      context: {},
      startedAt: new Date().toISOString(),
    };

    await memory.setTask(task);
    await memory.completeTask();

    expect(memory.getTask()).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/memory/WorkingMemory.test.ts`
Expected: FAIL

**Step 3: Implement WorkingMemory**

```typescript
// src/memory/WorkingMemory.ts
import fs from 'fs/promises';
import path from 'path';
import { Task } from './types.js';

export class WorkingMemory {
  private taskFile: string;
  private task: Task | null = null;

  constructor(baseDir: string = '.memory/working') {
    this.taskFile = path.join(baseDir, 'active-task.json');
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.taskFile);
    await fs.mkdir(dir, { recursive: true });
    await this.load();
  }

  async setTask(task: Task): Promise<void> {
    this.task = task;
    await this.save();
  }

  getTask(): Task | null {
    return this.task ? { ...this.task } : null;
  }

  async addContext(key: string, value: any): Promise<void> {
    if (!this.task) {
      throw new Error('No active task');
    }

    this.task.context[key] = value;
    await this.save();
  }

  async completeTask(): Promise<void> {
    if (!this.task) {
      return;
    }

    this.task.status = 'completed';
    await this.save();

    // Archive and clear
    this.task = null;
    await this.save();
  }

  async clear(): Promise<void> {
    this.task = null;
    await this.save();
  }

  private async save(): Promise<void> {
    const data = this.task ? JSON.stringify(this.task, null, 2) : JSON.stringify(null);
    await fs.writeFile(this.taskFile, data, 'utf-8');
  }

  private async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.taskFile, 'utf-8');
      const parsed = JSON.parse(data);
      this.task = parsed === null ? null : parsed;
    } catch (error) {
      // File doesn't exist, keep null
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/memory/WorkingMemory.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory/WorkingMemory.ts tests/memory/WorkingMemory.test.ts
git commit -m "feat(memory): implement WorkingMemory for task context"
```

---

## Task 4: Implement LongTermMemory class

**Files:**
- Create: `src/memory/LongTermMemory.ts`
- Test: `tests/memory/LongTermMemory.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/memory/LongTermMemory.test.ts
import { LongTermMemory } from '../src/memory/LongTermMemory.js';
import { Fact } from '../src/memory/types.js';
import fs from 'fs/promises';

describe('LongTermMemory', () => {
  const testDir = '.memory-test/long-term';
  let memory: LongTermMemory;

  beforeEach(async () => {
    memory = new LongTermMemory(testDir);
    await memory.initialize();
  });

  afterEach(async () => {
    await fs.rm('.memory-test', { recursive: true, force: true });
  });

  test('should update profile', async () => {
    await memory.updateProfile('style.tone', 'professional');
    const profile = memory.getProfile();

    expect(profile.style.tone).toBe('professional');
  });

  test('should add and remove constraints', async () => {
    await memory.addConstraint('forbidden', 'Python');
    await memory.addConstraint('required', 'TypeScript');

    let constraints = memory.getConstraints();
    expect(constraints.forbidden).toContain('Python');
    expect(constraints.required).toContain('TypeScript');

    await memory.removeConstraint('forbidden', 'Python');
    constraints = memory.getConstraints();
    expect(constraints.forbidden).not.toContain('Python');
  });

  test('should add knowledge fact', async () => {
    const fact: Fact = {
      id: 'fact-1',
      content: 'Test fact',
      addedAt: new Date().toISOString(),
      relevance: 'high',
    };

    await memory.addKnowledge(fact);
    const knowledge = memory.getKnowledge();

    expect(knowledge.facts).toHaveLength(1);
    expect(knowledge.facts[0].content).toBe('Test fact');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/memory/LongTermMemory.test.ts`
Expected: FAIL

**Step 3: Implement LongTermMemory**

```typescript
// src/memory/LongTermMemory.ts
import fs from 'fs/promises';
import path from 'path';
import { Profile, Constraints, Knowledge, Fact } from './types.js';

export class LongTermMemory {
  private profileFile: string;
  private constraintsFile: string;
  private knowledgeFile: string;

  private profile: Profile;
  private constraints: Constraints;
  private knowledge: Knowledge;

  constructor(baseDir: string = '.memory/long-term') {
    this.profileFile = path.join(baseDir, 'profile.json');
    this.constraintsFile = path.join(baseDir, 'constraints.json');
    this.knowledgeFile = path.join(baseDir, 'knowledge.json');

    // Defaults
    this.profile = {
      style: { responseLength: 'detailed', tone: 'professional', language: 'russian' },
      preferences: { stack: [], frameworks: [] },
    };
    this.constraints = { forbidden: [], required: [], rules: [] };
    this.knowledge = { facts: [], decisions: [] };
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.profileFile);
    await fs.mkdir(dir, { recursive: true });
    await this.load();
  }

  getProfile(): Profile {
    return { ...this.profile };
  }

  async updateProfile(key: string, value: any): Promise<void> {
    const keys = key.split('.');
    let obj: any = this.profile;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in obj)) {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }

    const lastKey = keys[keys.length - 1];

    // Handle arrays
    if (typeof value === 'string' && value.includes(',')) {
      obj[lastKey] = value.split(',').map(s => s.trim());
    } else {
      obj[lastKey] = value;
    }

    await this.saveProfile();
  }

  getConstraints(): Constraints {
    return { ...this.constraints };
  }

  async addConstraint(type: 'forbidden' | 'required' | 'rules', value: string): Promise<void> {
    if (!this.constraints[type].includes(value)) {
      this.constraints[type].push(value);
      await this.saveConstraints();
    }
  }

  async removeConstraint(type: 'forbidden' | 'required' | 'rules', value: string): Promise<void> {
    this.constraints[type] = this.constraints[type].filter(v => v !== value);
    await this.saveConstraints();
  }

  async addKnowledge(fact: Fact): Promise<void> {
    this.knowledge.facts.push(fact);
    await this.saveKnowledge();
  }

  getKnowledge(): Knowledge {
    return { ...this.knowledge };
  }

  async load(): Promise<void> {
    await this.loadProfile();
    await this.loadConstraints();
    await this.loadKnowledge();
  }

  async save(): Promise<void> {
    await this.saveProfile();
    await this.saveConstraints();
    await this.saveKnowledge();
  }

  private async loadProfile(): Promise<void> {
    try {
      const data = await fs.readFile(this.profileFile, 'utf-8');
      this.profile = JSON.parse(data);
    } catch (error) {
      // Use defaults
    }
  }

  private async saveProfile(): Promise<void> {
    await fs.writeFile(this.profileFile, JSON.stringify(this.profile, null, 2), 'utf-8');
  }

  private async loadConstraints(): Promise<void> {
    try {
      const data = await fs.readFile(this.constraintsFile, 'utf-8');
      this.constraints = JSON.parse(data);
    } catch (error) {
      // Use defaults
    }
  }

  private async saveConstraints(): Promise<void> {
    await fs.writeFile(this.constraintsFile, JSON.stringify(this.constraints, null, 2), 'utf-8');
  }

  private async loadKnowledge(): Promise<void> {
    try {
      const data = await fs.readFile(this.knowledgeFile, 'utf-8');
      this.knowledge = JSON.parse(data);
    } catch (error) {
      // Use defaults
    }
  }

  private async saveKnowledge(): Promise<void> {
    await fs.writeFile(this.knowledgeFile, JSON.stringify(this.knowledge, null, 2), 'utf-8');
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/memory/LongTermMemory.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory/LongTermMemory.ts tests/memory/LongTermMemory.test.ts
git commit -m "feat(memory): implement LongTermMemory for profile and knowledge"
```

---

## Task 5: Implement MemoryManager coordinator

**Files:**
- Create: `src/memory/MemoryManager.ts`
- Test: `tests/memory/MemoryManager.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/memory/MemoryManager.test.ts
import { MemoryManager } from '../src/memory/MemoryManager.js';
import { Message } from '../src/types/index.js';
import fs from 'fs/promises';

describe('MemoryManager', () => {
  let manager: MemoryManager;

  beforeEach(async () => {
    manager = new MemoryManager('.memory-test');
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.rm('.memory-test', { recursive: true, force: true });
  });

  test('should provide access to all memory layers', () => {
    expect(manager.getShortTerm()).toBeDefined();
    expect(manager.getWorking()).toBeDefined();
    expect(manager.getLongTerm()).toBeDefined();
  });

  test('should build context for prompt', () => {
    manager.getShortTerm().addMessage({ role: 'user', content: 'Test' });

    const context = manager.getContextForPrompt();

    expect(context.shortTerm).toHaveLength(1);
    expect(context.working).toBeNull();
    expect(context.longTerm.profile).toBeDefined();
  });

  test('should clear specific layer', async () => {
    manager.getShortTerm().addMessage({ role: 'user', content: 'Test' });
    await manager.clear('short');

    const context = manager.getContextForPrompt();
    expect(context.shortTerm).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test tests/memory/MemoryManager.test.ts`
Expected: FAIL

**Step 3: Implement MemoryManager**

```typescript
// src/memory/MemoryManager.ts
import { ShortTermMemory } from './ShortTermMemory.js';
import { WorkingMemory } from './WorkingMemory.js';
import { LongTermMemory } from './LongTermMemory.js';
import { MemoryContext, MemoryLayer } from './types.js';

export class MemoryManager {
  private shortTerm: ShortTermMemory;
  private working: WorkingMemory;
  private longTerm: LongTermMemory;

  constructor(baseDir: string = '.memory') {
    this.shortTerm = new ShortTermMemory(`${baseDir}/short-term`);
    this.working = new WorkingMemory(`${baseDir}/working`);
    this.longTerm = new LongTermMemory(`${baseDir}/long-term`);
  }

  async initialize(): Promise<void> {
    await this.shortTerm.initialize();
    await this.working.initialize();
    await this.longTerm.initialize();
  }

  getContextForPrompt(): MemoryContext {
    return {
      shortTerm: this.shortTerm.getMessages(),
      working: this.working.getTask(),
      longTerm: {
        profile: this.longTerm.getProfile(),
        constraints: this.longTerm.getConstraints(),
        knowledge: this.longTerm.getKnowledge().facts,
      },
    };
  }

  getShortTerm(): ShortTermMemory {
    return this.shortTerm;
  }

  getWorking(): WorkingMemory {
    return this.working;
  }

  getLongTerm(): LongTermMemory {
    return this.longTerm;
  }

  async clear(layer?: MemoryLayer): Promise<void> {
    if (!layer || layer === 'short') {
      this.shortTerm.clear();
      await this.shortTerm.save();
    }

    if (!layer || layer === 'working') {
      await this.working.clear();
    }

    if (!layer || layer === 'long') {
      // Don't clear long-term automatically - too destructive
      // User must manually edit files
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test tests/memory/MemoryManager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory/MemoryManager.ts tests/memory/MemoryManager.test.ts
git commit -m "feat(memory): implement MemoryManager coordinator"
```

---

## Task 6: Export memory module

**Files:**
- Create: `src/memory/index.ts`

**Step 1: Create barrel export**

```typescript
// src/memory/index.ts
export { MemoryManager } from './MemoryManager.js';
export { ShortTermMemory } from './ShortTermMemory.js';
export { WorkingMemory } from './WorkingMemory.js';
export { LongTermMemory } from './LongTermMemory.js';
export * from './types.js';
```

**Step 2: Verify exports**

Run: `npm run build`
Expected: SUCCESS with no errors

**Step 3: Commit**

```bash
git add src/memory/index.ts
git commit -m "feat(memory): add barrel exports for memory module"
```

---

## Task 7: Integrate MemoryManager with Conversation

**Files:**
- Modify: `src/chat/conversation.ts`

**Step 1: Add MemoryManager to Conversation**

```typescript
// src/chat/conversation.ts
// Add import
import { MemoryManager } from '../memory/index.js';

// Add to class
export class Conversation {
  private messages: Message[] = [];
  private sessionManager: SessionManager;
  private currentSessionId: string;
  private summary: string | null = null;
  private needsSummarizationFlag: boolean = false;
  private strategy: IContextStrategy;
  private allMessages: Message[] = [];
  private memoryManager: MemoryManager;  // NEW

  constructor(sessionManager: SessionManager, strategy?: IContextStrategy) {
    this.sessionManager = sessionManager;
    this.currentSessionId = sessionManager.createSession();
    this.strategy = strategy || new SlidingWindowStrategy(10);
    this.memoryManager = new MemoryManager();  // NEW
  }

  // Add initialization method
  async initialize(): Promise<void> {
    await this.memoryManager.initialize();
  }

  // Add accessor
  getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }

  // Update addUserMessage to sync with memory
  async addUserMessage(content: string): Promise<void> {
    const message: Message = { role: 'user', content };
    this.messages.push(message);
    this.allMessages.push(message);
    await this.strategy.addMessage(message);
    this.memoryManager.getShortTerm().addMessage(message);  // NEW
  }

  async addAssistantMessage(content: string, metadata?: MessageMetadata): Promise<void> {
    const message: Message = {
      role: 'assistant',
      content,
      metadata
    };
    this.messages.push(message);
    this.allMessages.push(message);
    await this.strategy.addMessage(message);
    this.memoryManager.getShortTerm().addMessage(message);  // NEW
  }
}
```

**Step 2: Test integration manually**

Run: `npm run build && npm start`
Expected: App starts without errors

**Step 3: Commit**

```bash
git add src/chat/conversation.ts
git commit -m "feat(memory): integrate MemoryManager with Conversation"
```

---

## Task 8: Add buildSystemPromptWithMemory method

**Files:**
- Modify: `src/chat/conversation.ts`

**Step 1: Add method to build system prompt with memory**

```typescript
// src/chat/conversation.ts
import { MemoryContext } from '../memory/index.js';

export class Conversation {
  // ... existing code ...

  buildSystemPromptWithMemory(basePrompt?: string): string {
    const context = this.memoryManager.getContextForPrompt();
    let prompt = basePrompt || 'Ты полезный AI ассистент.\n\n';

    // Add profile
    if (context.longTerm.profile.preferences.stack.length > 0) {
      prompt += `# Профиль пользователя\n`;
      prompt += `Предпочитаемый стек: ${context.longTerm.profile.preferences.stack.join(', ')}\n`;
      if (context.longTerm.profile.preferences.frameworks.length > 0) {
        prompt += `Фреймворки: ${context.longTerm.profile.preferences.frameworks.join(', ')}\n`;
      }
      prompt += `Стиль ответов: ${context.longTerm.profile.style.responseLength}\n`;
      prompt += `Тон: ${context.longTerm.profile.style.tone}\n\n`;
    }

    // Add constraints
    const constraints = context.longTerm.constraints;
    if (constraints.forbidden.length > 0 || constraints.required.length > 0 || constraints.rules.length > 0) {
      prompt += `# Ограничения\n`;
      if (constraints.forbidden.length > 0) {
        prompt += `Запрещено использовать: ${constraints.forbidden.join(', ')}\n`;
      }
      if (constraints.required.length > 0) {
        prompt += `Обязательно использовать: ${constraints.required.join(', ')}\n`;
      }
      if (constraints.rules.length > 0) {
        prompt += `Правила:\n`;
        constraints.rules.forEach(rule => {
          prompt += `- ${rule}\n`;
        });
      }
      prompt += '\n';
    }

    // Add active task
    if (context.working) {
      prompt += `# Текущая задача\n`;
      prompt += `${context.working.description}\n`;
      if (Object.keys(context.working.context).length > 0) {
        prompt += `Контекст: ${JSON.stringify(context.working.context, null, 2)}\n`;
      }
      prompt += '\n';
    }

    // Add high-relevance knowledge
    const highRelevanceKnowledge = context.longTerm.knowledge.filter(f => f.relevance === 'high');
    if (highRelevanceKnowledge.length > 0) {
      prompt += `# Важная информация о проекте\n`;
      highRelevanceKnowledge.forEach(fact => {
        prompt += `- ${fact.content}\n`;
      });
      prompt += '\n';
    }

    return prompt;
  }
}
```

**Step 2: Test method**

Run: `npm run build`
Expected: SUCCESS

**Step 3: Commit**

```bash
git add src/chat/conversation.ts
git commit -m "feat(memory): add buildSystemPromptWithMemory method"
```

---

## Task 9: Add memory commands to Chat component

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add /memory command handler**

```typescript
// src/components/Chat.tsx
// In handleCommand function, add after other commands:

if (trimmed.startsWith('/memory')) {
  handleMemoryCommand(trimmed);
  return;
}

// Add handler function before component return
function handleMemoryCommand(command: string): void {
  const parts = command.split(' ').filter(Boolean);

  if (parts.length === 1) {
    // Show all memory
    const context = conversation.getMemoryManager().getContextForPrompt();

    let output = '\n=== ПАМЯТЬ АГЕНТА ===\n\n';

    output += '📝 КРАТКОСРОЧНАЯ ПАМЯТЬ (Short-term):\n';
    output += `  Сообщений: ${context.shortTerm.length}\n\n`;

    output += '🎯 РАБОЧАЯ ПАМЯТЬ (Working):\n';
    if (context.working) {
      output += `  Задача: ${context.working.description}\n`;
      output += `  Статус: ${context.working.status}\n`;
    } else {
      output += '  Нет активной задачи\n';
    }
    output += '\n';

    output += '💾 ДОЛГОВРЕМЕННАЯ ПАМЯТЬ (Long-term):\n';
    output += `  Профиль:\n`;
    output += `    Стек: ${context.longTerm.profile.preferences.stack.join(', ') || 'не задан'}\n`;
    output += `    Тон: ${context.longTerm.profile.style.tone}\n`;
    output += `  Ограничения:\n`;
    output += `    Запрещено: ${context.longTerm.constraints.forbidden.join(', ') || 'нет'}\n`;
    output += `    Требуется: ${context.longTerm.constraints.required.join(', ') || 'нет'}\n`;
    output += `  Знания: ${context.longTerm.knowledge.length} фактов\n`;

    setNotification(output);
    return;
  }

  const subcommand = parts[1];

  if (subcommand === 'short' || subcommand === 'working' || subcommand === 'long') {
    const context = conversation.getMemoryManager().getContextForPrompt();
    let output = '';

    if (subcommand === 'short') {
      output = '\n📝 КРАТКОСРОЧНАЯ ПАМЯТЬ:\n\n';
      context.shortTerm.forEach((msg, i) => {
        output += `[${i + 1}] ${msg.role}: ${msg.content.substring(0, 60)}...\n`;
      });
    } else if (subcommand === 'working') {
      output = '\n🎯 РАБОЧАЯ ПАМЯТЬ:\n\n';
      if (context.working) {
        output += `Задача: ${context.working.description}\n`;
        output += `Статус: ${context.working.status}\n`;
        output += `Контекст: ${JSON.stringify(context.working.context, null, 2)}\n`;
      } else {
        output += 'Нет активной задачи\n';
      }
    } else if (subcommand === 'long') {
      output = '\n💾 ДОЛГОВРЕМЕННАЯ ПАМЯТЬ:\n\n';
      output += 'Профиль:\n';
      output += JSON.stringify(context.longTerm.profile, null, 2) + '\n\n';
      output += 'Ограничения:\n';
      output += JSON.stringify(context.longTerm.constraints, null, 2) + '\n\n';
      output += `Знания (${context.longTerm.knowledge.length} фактов):\n`;
      context.longTerm.knowledge.forEach(fact => {
        output += `- [${fact.relevance}] ${fact.content}\n`;
      });
    }

    setNotification(output);
    return;
  }

  if (parts[1] === 'clear' && parts[2]) {
    const layer = parts[2] as 'short' | 'working' | 'long';
    conversation.getMemoryManager().clear(layer);
    setNotification(`✓ Слой памяти "${layer}" очищен`);
    return;
  }

  setNotification('Использование: /memory [short|working|long] или /memory clear <слой>');
}
```

**Step 2: Test command**

Run: `npm run build && npm start`
Type: `/memory`
Expected: Shows memory overview

**Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(memory): add /memory command to view memory layers"
```

---

## Task 10: Add /remember command

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add /remember command handler**

```typescript
// src/components/Chat.tsx
// In handleCommand function:

if (trimmed.startsWith('/remember ')) {
  handleRememberCommand(trimmed);
  return;
}

// Add handler function
function handleRememberCommand(command: string): void {
  const content = command.substring(10).trim(); // Remove "/remember "

  if (!content) {
    setNotification('Использование: /remember <что запомнить>');
    return;
  }

  const fact = {
    id: `fact-${Date.now()}`,
    content,
    addedAt: new Date().toISOString(),
    relevance: 'high' as const,
  };

  conversation.getMemoryManager().getLongTerm().addKnowledge(fact);
  setNotification(`✓ Сохранено в долговременную память: "${content}"`);
}
```

**Step 2: Test command**

Run: `npm run build && npm start`
Type: `/remember В проекте используется TypeScript`
Expected: Fact saved successfully

**Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(memory): add /remember command to save knowledge"
```

---

## Task 11: Add /task commands

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add /task command handlers**

```typescript
// src/components/Chat.tsx
// In handleCommand function:

if (trimmed.startsWith('/task')) {
  handleTaskCommand(trimmed);
  return;
}

// Add handler function
function handleTaskCommand(command: string): void {
  const parts = command.split(' ').filter(Boolean);

  if (parts.length < 2) {
    setNotification('Использование: /task start <описание> | /task context <данные> | /task done | /task show');
    return;
  }

  const subcommand = parts[1];
  const memoryManager = conversation.getMemoryManager();

  if (subcommand === 'start') {
    const description = parts.slice(2).join(' ');
    if (!description) {
      setNotification('Укажите описание задачи');
      return;
    }

    const task = {
      taskId: `task-${Date.now()}`,
      description,
      status: 'in_progress' as const,
      context: {},
      startedAt: new Date().toISOString(),
    };

    memoryManager.getWorking().setTask(task);
    setNotification(`✓ Задача создана: "${description}"`);
  } else if (subcommand === 'context') {
    const contextData = parts.slice(2).join(' ');
    if (!contextData) {
      setNotification('Укажите контекст в формате key=value');
      return;
    }

    const [key, ...valueParts] = contextData.split('=');
    const value = valueParts.join('=');

    try {
      memoryManager.getWorking().addContext(key, value);
      setNotification(`✓ Контекст добавлен: ${key} = ${value}`);
    } catch (error) {
      setNotification('❌ Нет активной задачи. Используйте /task start');
    }
  } else if (subcommand === 'done') {
    memoryManager.getWorking().completeTask();
    setNotification('✓ Задача завершена');
  } else if (subcommand === 'show') {
    const task = memoryManager.getWorking().getTask();
    if (!task) {
      setNotification('Нет активной задачи');
      return;
    }

    let output = '\n🎯 АКТИВНАЯ ЗАДАЧА:\n\n';
    output += `Описание: ${task.description}\n`;
    output += `Статус: ${task.status}\n`;
    output += `Начата: ${task.startedAt}\n`;
    output += `Контекст: ${JSON.stringify(task.context, null, 2)}\n`;

    setNotification(output);
  } else {
    setNotification('Неизвестная подкоманда. Используйте: start, context, done, show');
  }
}
```

**Step 2: Test commands**

Run: `npm run build && npm start`
Commands:
- `/task start Test task`
- `/task context files=test.ts`
- `/task show`
- `/task done`

Expected: All work correctly

**Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(memory): add /task commands for working memory"
```

---

## Task 12: Add /profile commands

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add /profile command handlers**

```typescript
// src/components/Chat.tsx
// In handleCommand function:

if (trimmed.startsWith('/profile')) {
  handleProfileCommand(trimmed);
  return;
}

// Add handler function
function handleProfileCommand(command: string): void {
  const parts = command.split(' ').filter(Boolean);

  if (parts.length < 2) {
    setNotification('Использование: /profile set <ключ> <значение> | /profile show');
    return;
  }

  const subcommand = parts[1];
  const memoryManager = conversation.getMemoryManager();

  if (subcommand === 'set') {
    if (parts.length < 4) {
      setNotification('Использование: /profile set <ключ> <значение>');
      return;
    }

    const key = parts[2];
    const value = parts.slice(3).join(' ');

    memoryManager.getLongTerm().updateProfile(key, value);
    setNotification(`✓ Профиль обновлен: ${key} = ${value}`);
  } else if (subcommand === 'show') {
    const profile = memoryManager.getLongTerm().getProfile();
    const output = '\n👤 ПРОФИЛЬ:\n\n' + JSON.stringify(profile, null, 2);
    setNotification(output);
  } else {
    setNotification('Неизвестная подкоманда. Используйте: set, show');
  }
}
```

**Step 2: Test commands**

Run: `npm run build && npm start`
Commands:
- `/profile set stack TypeScript,Node.js`
- `/profile set style.tone professional`
- `/profile show`

Expected: Profile updated correctly

**Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(memory): add /profile commands for user profile"
```

---

## Task 13: Add /constraint commands

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add /constraint command handlers**

```typescript
// src/components/Chat.tsx
// In handleCommand function:

if (trimmed.startsWith('/constraint')) {
  handleConstraintCommand(trimmed);
  return;
}

// Add handler function
function handleConstraintCommand(command: string): void {
  const parts = command.split(' ').filter(Boolean);

  if (parts.length < 2) {
    setNotification('Использование: /constraint add <тип> <значение> | /constraint remove <тип> <значение> | /constraint list');
    return;
  }

  const subcommand = parts[1];
  const memoryManager = conversation.getMemoryManager();

  if (subcommand === 'add') {
    if (parts.length < 4) {
      setNotification('Использование: /constraint add <forbidden|required|rules> <значение>');
      return;
    }

    const type = parts[2] as 'forbidden' | 'required' | 'rules';
    const value = parts.slice(3).join(' ');

    if (!['forbidden', 'required', 'rules'].includes(type)) {
      setNotification('Тип должен быть: forbidden, required, или rules');
      return;
    }

    memoryManager.getLongTerm().addConstraint(type, value);
    setNotification(`✓ Ограничение добавлено: ${type} = ${value}`);
  } else if (subcommand === 'remove') {
    if (parts.length < 4) {
      setNotification('Использование: /constraint remove <тип> <значение>');
      return;
    }

    const type = parts[2] as 'forbidden' | 'required' | 'rules';
    const value = parts.slice(3).join(' ');

    memoryManager.getLongTerm().removeConstraint(type, value);
    setNotification(`✓ Ограничение удалено: ${type} = ${value}`);
  } else if (subcommand === 'list') {
    const constraints = memoryManager.getLongTerm().getConstraints();
    let output = '\n🚫 ОГРАНИЧЕНИЯ:\n\n';
    output += `Запрещено: ${constraints.forbidden.join(', ') || 'нет'}\n`;
    output += `Требуется: ${constraints.required.join(', ') || 'нет'}\n`;
    output += `Правила:\n`;
    constraints.rules.forEach(rule => {
      output += `  - ${rule}\n`;
    });
    setNotification(output);
  } else {
    setNotification('Неизвестная подкоманда. Используйте: add, remove, list');
  }
}
```

**Step 2: Test commands**

Run: `npm run build && npm start`
Commands:
- `/constraint add forbidden Python`
- `/constraint add required TypeScript`
- `/constraint list`
- `/constraint remove forbidden Python`

Expected: Constraints managed correctly

**Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(memory): add /constraint commands for constraints"
```

---

## Task 14: Update help text with memory commands

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Update help text**

Find the help text string and add memory section:

```typescript
const helpText = `
Доступные команды:

Управление моделями:
  /model              - показать список доступных моделей
  /model <номер>      - переключиться на модель
  /model add <id>     - добавить модель в избранное
  /model remove <n>   - удалить модель

Управление контекстом:
  /clear              - очистить контекст и статистику
  /compact            - ручная суммаризация контекста
  /stats              - показать историю запросов

Управление сессиями:
  /resume             - показать список сохраненных сессий
  /resume <номер>     - загрузить сессию

Стратегии контекста:
  /strategy           - показать текущую стратегию
  /strategy set <n>   - установить стратегию
  /strategy list      - список доступных стратегий

Управление памятью:
  /memory             - показать всю память по слоям
  /memory <слой>      - показать конкретный слой (short/working/long)
  /memory clear <слой> - очистить слой памяти

  /remember <текст>   - сохранить факт в долговременную память
                        Используется для запоминания важной информации о проекте

  /task start <описание> - начать новую задачу
  /task context <данные> - добавить контекст к текущей задаче (формат: key=value)
  /task done             - завершить текущую задачу
  /task show             - показать активную задачу

  /profile set <ключ> <значение> - установить параметр профиля
                                   Примеры: style.tone, stack, frameworks
  /profile show                  - показать весь профиль

  /constraint add <тип> <значение> - добавить ограничение
                                     Типы: forbidden, required, rules
  /constraint remove <тип> <значение> - удалить ограничение
  /constraint list                    - показать все ограничения

Общие:
  /help               - показать это сообщение
  Ctrl+C              - выход
`;
```

**Step 2: Verify help displays correctly**

Run: `npm run build && npm start`
Type: `/help`
Expected: All memory commands visible

**Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "docs(memory): update help text with memory commands"
```

---

## Task 15: Use memory in API calls

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Update sendMessage to use memory context**

Find the `handleSubmit` function and modify it to use memory-enhanced system prompt:

```typescript
async function handleSubmit() {
  if (!input.trim() || isLoading) return;

  const userInput = input.trim();
  setInput('');
  setError(null);

  // Handle commands
  if (userInput.startsWith('/')) {
    handleCommand(userInput);
    return;
  }

  await conversation.addUserMessage(userInput);
  const updatedHistory = conversation.getHistory();
  setMessages(updatedHistory);

  setIsLoading(true);

  try {
    const apiMessages = await conversation.getMessagesForAPI();

    // Build system prompt with memory context
    const memoryPrompt = conversation.buildSystemPromptWithMemory(
      buildSystemPrompt(activeSkills)
    );

    // Prepare messages with memory-enhanced system prompt
    const messagesForApi = memoryPrompt
      ? [{ role: 'system' as const, content: memoryPrompt }, ...apiMessages]
      : apiMessages;

    const response = await sendMessage(messagesForApi, currentModel, undefined, temperature);

    const metadata: MessageMetadata = {
      usage: response.usage,
      responseTime: response.responseTime,
      cost: response.usage
        ? modelRegistry.calculateCost(currentModel, response.usage)
        : 0,
      model: currentModel,
      timestamp: new Date().toISOString(),
    };

    await conversation.addAssistantMessage(response.content, metadata);

    // Save to short-term memory
    await conversation.getMemoryManager().getShortTerm().save();

    // ... rest of the function
  } catch (err) {
    // ... error handling
  } finally {
    setIsLoading(false);
  }
}
```

**Step 2: Test memory integration**

Run: `npm run build && npm start`

Test scenario:
1. `/profile set stack TypeScript`
2. Ask: "Напиши функцию для чтения файла"
3. Verify response uses TypeScript

**Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(memory): integrate memory context into API calls"
```

---

## Task 16: Initialize memory on app start

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add initialization effect**

```typescript
// src/components/Chat.tsx
// Add after other useEffect hooks

useEffect(() => {
  // Initialize memory manager
  conversation.initialize().catch(err => {
    console.error('Failed to initialize memory:', err);
  });
}, []);
```

**Step 2: Test initialization**

Run: `npm run build && npm start`
Check: `.memory/` directory created with subdirectories

**Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(memory): initialize memory manager on app start"
```

---

## Task 17: Update .gitignore for memory files

**Files:**
- Modify: `.gitignore`

**Step 1: Add memory directory to gitignore**

```
node_modules/
dist/
.env
*.log
config.json
config.json.backup
.chat-history/
.memory/
```

**Step 2: Verify gitignore works**

Run: `git status`
Expected: `.memory/` not shown in untracked files

**Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add .memory directory to gitignore"
```

---

## Task 18: Create verification test scenarios

**Files:**
- Create: `docs/testing/2026-03-02-memory-layers-verification.md`

**Step 1: Write verification document**

```markdown
# Memory Layers Verification

**Date:** 2026-03-02
**Feature:** Memory layers implementation

## Test Scenarios

### Test 1: Short-term Memory (Current Dialog)

**Goal:** Verify agent remembers previous messages in current session

**Steps:**
1. Start app: `npm start`
2. User: "Меня зовут Антон"
3. Assistant responds
4. User: "Как меня зовут?"
5. Assistant should say: "Вас зовут Антон"

**Expected:** ✓ Agent remembers name from earlier in conversation

**Result:**

### Test 2: Working Memory (Task Context)

**Goal:** Verify task context influences responses

**Steps:**
1. Start app
2. User: `/task start Реализовать команду /memory`
3. User: "Как мне это сделать?"
4. Assistant should understand "это" = текущая задача

**Expected:** ✓ Agent understands implicit reference to active task

**Result:**

### Test 3: Long-term Memory (Profile)

**Goal:** Verify profile affects code generation

**Steps:**
1. Start app
2. User: `/profile set stack TypeScript`
3. User: "Напиши функцию для чтения файла"
4. Assistant should generate TypeScript code

**Expected:** ✓ Agent uses TypeScript from profile

**Result:**

### Test 4: Constraints

**Goal:** Verify constraints prevent unwanted suggestions

**Steps:**
1. Start app
2. User: `/constraint add forbidden Python`
3. User: "Напиши скрипт для парсинга JSON"
4. Assistant should NOT suggest Python

**Expected:** ✓ Agent respects forbidden constraint

**Result:**

### Test 5: Knowledge Facts

**Goal:** Verify remembered facts are used

**Steps:**
1. Start app
2. User: `/remember В проекте используется Ink для CLI UI`
3. User: "Как вывести цветной текст в консоли?"
4. Assistant should mention Ink and <Text> component

**Expected:** ✓ Agent uses remembered project knowledge

**Result:**

## Verification Checklist

- [ ] All memory commands work (/memory, /remember, /task, /profile, /constraint)
- [ ] Memory persists to files in .memory/ directory
- [ ] System prompt includes memory context
- [ ] Responses respect profile and constraints
- [ ] Help text documents all commands
```

**Step 2: Commit**

```bash
git add docs/testing/2026-03-02-memory-layers-verification.md
git commit -m "docs: add memory layers verification test scenarios"
```

---

## Task 19: Run all tests

**Step 1: Run complete test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Fix any failing tests**

If tests fail, fix issues and re-run

**Step 3: Commit any fixes**

```bash
git add .
git commit -m "fix: resolve test failures in memory implementation"
```

---

## Task 20: Manual verification and documentation

**Step 1: Run manual tests**

Follow verification document:
`docs/testing/2026-03-02-memory-layers-verification.md`

Fill in results for each test scenario

**Step 2: Document findings**

Update verification document with results

**Step 3: Final commit**

```bash
git add docs/testing/2026-03-02-memory-layers-verification.md
git commit -m "docs: complete memory layers verification testing"
```

---

## Completion

All tasks completed! The memory layers system is now:
- ✅ Implemented with three distinct layers
- ✅ Stored in separate JSON files
- ✅ Controllable through CLI commands
- ✅ Integrated with agent responses
- ✅ Tested and verified

The agent now has explicit memory model that influences its behavior based on user profile, active tasks, and accumulated knowledge.
