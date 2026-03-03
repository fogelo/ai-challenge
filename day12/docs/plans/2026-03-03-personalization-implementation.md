# Personalization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement multiple user profiles with interview-based creation to personalize agent responses based on style, tone, context, and technical preferences.

**Architecture:** Create ProfileManager for multi-profile support, InterviewFlow for guided profile creation, integrate with existing MemoryManager to inject active profile into LongTermMemory, and update Chat commands for profile management.

**Tech Stack:** TypeScript, Node.js fs/promises, Ink (for interactive interview UI)

---

## Task 1: Create Profile Types

**Files:**
- Create: `src/profile/types.ts`

**Step 1: Write profile type definitions**

Create the file with complete type definitions:

```typescript
export interface UserProfile {
  name: string;

  // Style
  responseStyle: 'краткий' | 'подробный';
  tone: 'формальный' | 'разговорный';
  includeCodeExamples: boolean;
  detailLevel: 'минимальный' | 'средний' | 'максимальный';

  // Context
  context: {
    purpose: string;
    domain: string;
    goals: string[];
  };

  // Technical preferences
  stack: string[];
  preferredLanguage: string;

  // Constraints
  constraints: {
    forbidden: string[];
    required: string[];
    rules: string[];
  };
}

export interface ProfileMetadata {
  name: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface InterviewQuestion {
  id: string;
  question: string;
  type: 'choice' | 'text' | 'multitext' | 'skip';
  options?: string[];
  defaultValue?: string;
  canSkip?: boolean;
}

export interface InterviewAnswers {
  profileName: string;
  purpose: string;
  responseStyle: 'краткий' | 'подробный';
  tone: 'формальный' | 'разговорный';
  includeCodeExamples: boolean;
  stack: string[];
  preferredLanguage: string;
  detailLevel: 'минимальный' | 'средний' | 'максимальный';
}
```

**Step 2: Verify TypeScript compilation**

Run: `npm run build`
Expected: No compilation errors

**Step 3: Commit**

```bash
git add src/profile/types.ts
git commit -m "feat(profile): add profile type definitions

- UserProfile with style, context, and constraints
- InterviewQuestion and InterviewAnswers for guided setup
- ProfileMetadata for tracking usage"
```

---

## Task 2: Create ProfileManager

**Files:**
- Create: `src/profile/ProfileManager.ts`

**Step 1: Write ProfileManager class skeleton**

```typescript
import fs from 'fs/promises';
import path from 'path';
import { UserProfile, ProfileMetadata } from './types.js';

export class ProfileManager {
  private profilesDir: string;
  private activeFile: string;
  private activeProfile: UserProfile | null = null;

  constructor(baseDir: string = '.memory/profiles') {
    this.profilesDir = baseDir;
    this.activeFile = path.join(baseDir, '.active');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.profilesDir, { recursive: true });

    // Load active profile if exists
    if (await this.hasProfiles()) {
      const activeName = await this.loadActiveName();
      if (activeName) {
        this.activeProfile = await this.loadProfile(activeName);
      }
    }
  }

  async hasProfiles(): Promise<boolean> {
    try {
      const files = await fs.readdir(this.profilesDir);
      return files.some(f => f.endsWith('.json') && f !== '.active');
    } catch {
      return false;
    }
  }

  private async loadActiveName(): Promise<string | null> {
    try {
      const content = await fs.readFile(this.activeFile, 'utf-8');
      return content.trim();
    } catch {
      return null;
    }
  }

  private async saveActiveName(name: string): Promise<void> {
    await fs.writeFile(this.activeFile, name, 'utf-8');
  }

  private getProfilePath(name: string): string {
    return path.join(this.profilesDir, `${name}.json`);
  }

  async loadProfile(name: string): Promise<UserProfile | null> {
    try {
      const data = await fs.readFile(this.getProfilePath(name), 'utf-8');
      const profile = JSON.parse(data);
      this.validateProfile(profile);
      return profile;
    } catch {
      return null;
    }
  }

  private validateProfile(profile: any): profile is UserProfile {
    const required = ['name', 'responseStyle', 'tone', 'includeCodeExamples', 'context'];

    for (const field of required) {
      if (!(field in profile)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (!['краткий', 'подробный'].includes(profile.responseStyle)) {
      throw new Error('Invalid responseStyle');
    }

    if (!['формальный', 'разговорный'].includes(profile.tone)) {
      throw new Error('Invalid tone');
    }

    return true;
  }

  async createProfile(profile: UserProfile): Promise<void> {
    await fs.writeFile(
      this.getProfilePath(profile.name),
      JSON.stringify(profile, null, 2),
      'utf-8'
    );

    // Set as active if it's the first profile
    if (!await this.loadActiveName()) {
      await this.saveActiveName(profile.name);
      this.activeProfile = profile;
    }
  }

  async listProfiles(): Promise<ProfileMetadata[]> {
    try {
      const files = await fs.readdir(this.profilesDir);
      const profiles: ProfileMetadata[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const name = file.replace('.json', '');
          const profilePath = this.getProfilePath(name);
          const stats = await fs.stat(profilePath);

          profiles.push({
            name,
            createdAt: stats.birthtime.toISOString(),
            lastUsedAt: stats.mtime.toISOString(),
          });
        }
      }

      return profiles;
    } catch {
      return [];
    }
  }

  getActiveProfile(): UserProfile | null {
    return this.activeProfile;
  }

  async switchProfile(name: string): Promise<boolean> {
    const profile = await this.loadProfile(name);

    if (!profile) {
      return false;
    }

    await this.saveActiveName(name);
    this.activeProfile = profile;

    // Update lastUsedAt
    await fs.utimes(this.getProfilePath(name), new Date(), new Date());

    return true;
  }

  async deleteProfile(name: string): Promise<boolean> {
    // Don't delete active profile
    const activeName = await this.loadActiveName();
    if (name === activeName) {
      return false;
    }

    // Don't delete last profile
    const profiles = await this.listProfiles();
    if (profiles.length <= 1) {
      return false;
    }

    try {
      await fs.unlink(this.getProfilePath(name));
      return true;
    } catch {
      return false;
    }
  }

  async updateProfile(name: string, updates: Partial<UserProfile>): Promise<boolean> {
    const profile = await this.loadProfile(name);

    if (!profile) {
      return false;
    }

    const updated = { ...profile, ...updates };
    await this.createProfile(updated);

    // Update active profile if it's the current one
    if (this.activeProfile?.name === name) {
      this.activeProfile = updated;
    }

    return true;
  }

  createDefaultProfile(): UserProfile {
    return {
      name: 'default',
      responseStyle: 'подробный',
      tone: 'разговорный',
      includeCodeExamples: true,
      detailLevel: 'средний',
      context: {
        purpose: 'общее использование',
        domain: 'программирование',
        goals: [],
      },
      stack: [],
      preferredLanguage: 'typescript',
      constraints: {
        forbidden: [],
        required: [],
        rules: [],
      },
    };
  }
}
```

**Step 2: Verify TypeScript compilation**

Run: `npm run build`
Expected: No compilation errors

**Step 3: Commit**

```bash
git add src/profile/ProfileManager.ts
git commit -m "feat(profile): implement ProfileManager

- CRUD operations for profiles
- Active profile tracking
- Validation and error handling
- Default profile creation"
```

---

## Task 3: Create InterviewFlow

**Files:**
- Create: `src/profile/InterviewFlow.ts`

**Step 1: Write InterviewFlow class**

```typescript
import { UserProfile, InterviewQuestion, InterviewAnswers } from './types.js';

export class InterviewFlow {
  private questions: InterviewQuestion[] = [
    {
      id: 'profileName',
      question: 'Как назовем этот профиль?',
      type: 'text',
      defaultValue: 'default',
      canSkip: false,
    },
    {
      id: 'purpose',
      question: 'Для чего вы будете использовать агента?',
      type: 'choice',
      options: [
        '1. Разработка проектов',
        '2. Изучение технологий',
        '3. Помощь в обучении',
        '4. Консультации по архитектуре',
        '5. Другое',
      ],
      canSkip: false,
    },
    {
      id: 'responseStyle',
      question: 'Предпочитаемый стиль ответов?',
      type: 'choice',
      options: ['1. Краткий', '2. Подробный'],
      canSkip: false,
    },
    {
      id: 'tone',
      question: 'Тон общения?',
      type: 'choice',
      options: ['1. Формальный', '2. Разговорный'],
      canSkip: false,
    },
    {
      id: 'includeCodeExamples',
      question: 'Включать примеры кода в ответы?',
      type: 'choice',
      options: ['1. Да', '2. Нет'],
      canSkip: false,
    },
    {
      id: 'stack',
      question: 'Основной стек технологий? (через запятую, или пропустить)',
      type: 'multitext',
      canSkip: true,
    },
    {
      id: 'preferredLanguage',
      question: 'Предпочитаемый язык программирования? (или пропустить)',
      type: 'text',
      defaultValue: 'typescript',
      canSkip: true,
    },
    {
      id: 'detailLevel',
      question: 'Уровень детализации ответов?',
      type: 'choice',
      options: ['1. Минимальный', '2. Средний', '3. Максимальный'],
      canSkip: false,
    },
  ];

  getQuestions(): InterviewQuestion[] {
    return this.questions;
  }

  parseAnswer(question: InterviewQuestion, answer: string): any {
    if (answer.toLowerCase() === 'skip' && question.canSkip) {
      return question.defaultValue || '';
    }

    switch (question.type) {
      case 'choice': {
        const match = answer.match(/^(\d+)/);
        if (match && question.options) {
          const index = parseInt(match[1]) - 1;
          if (index >= 0 && index < question.options.length) {
            return question.options[index].replace(/^\d+\.\s*/, '');
          }
        }
        return answer;
      }
      case 'multitext': {
        return answer.split(',').map(s => s.trim()).filter(Boolean);
      }
      case 'text':
      default:
        return answer.trim();
    }
  }

  buildProfile(answers: Record<string, any>): UserProfile {
    const purposeMap: Record<string, string> = {
      'Разработка проектов': 'разработка проектов',
      'Изучение технологий': 'изучение технологий',
      'Помощь в обучении': 'помощь в обучении',
      'Консультации по архитектуре': 'консультации по архитектуре',
      'Другое': answers['purposeCustom'] || 'общее использование',
    };

    const purpose = purposeMap[answers['purpose']] || answers['purpose'] || 'общее использование';

    return {
      name: answers['profileName'] || 'default',
      responseStyle: answers['responseStyle'] === 'Краткий' ? 'краткий' : 'подробный',
      tone: answers['tone'] === 'Формальный' ? 'формальный' : 'разговорный',
      includeCodeExamples: answers['includeCodeExamples'] === 'Да',
      detailLevel: this.mapDetailLevel(answers['detailLevel']),
      context: {
        purpose,
        domain: this.inferDomain(purpose),
        goals: [],
      },
      stack: Array.isArray(answers['stack']) ? answers['stack'] : [],
      preferredLanguage: answers['preferredLanguage'] || 'typescript',
      constraints: {
        forbidden: [],
        required: [],
        rules: [],
      },
    };
  }

  private mapDetailLevel(answer: string): 'минимальный' | 'средний' | 'максимальный' {
    if (answer?.includes('Минимальный')) return 'минимальный';
    if (answer?.includes('Максимальный')) return 'максимальный';
    return 'средний';
  }

  private inferDomain(purpose: string): string {
    if (purpose.includes('разработка') || purpose.includes('проект')) {
      return 'программирование';
    }
    if (purpose.includes('обучение') || purpose.includes('изучение')) {
      return 'обучение';
    }
    if (purpose.includes('архитектура')) {
      return 'архитектура';
    }
    return 'общее';
  }

  validateAnswers(answers: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!answers['profileName'] || answers['profileName'].trim() === '') {
      errors.push('Имя профиля обязательно');
    }

    const required = ['purpose', 'responseStyle', 'tone', 'includeCodeExamples', 'detailLevel'];
    for (const field of required) {
      if (!answers[field]) {
        errors.push(`Поле ${field} обязательно`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
```

**Step 2: Verify TypeScript compilation**

Run: `npm run build`
Expected: No compilation errors

**Step 3: Commit**

```bash
git add src/profile/InterviewFlow.ts
git commit -m "feat(profile): implement InterviewFlow

- Question definitions for profile setup
- Answer parsing and validation
- Profile building from answers
- Domain inference from purpose"
```

---

## Task 4: Create Profile Index

**Files:**
- Create: `src/profile/index.ts`

**Step 1: Write exports**

```typescript
export { ProfileManager } from './ProfileManager.js';
export { InterviewFlow } from './InterviewFlow.js';
export * from './types.js';
```

**Step 2: Verify TypeScript compilation**

Run: `npm run build`
Expected: No compilation errors

**Step 3: Commit**

```bash
git add src/profile/index.ts
git commit -m "feat(profile): add profile module exports"
```

---

## Task 5: Integrate ProfileManager with MemoryManager

**Files:**
- Modify: `src/memory/MemoryManager.ts`

**Step 1: Import ProfileManager**

Add at top of file:

```typescript
import { ProfileManager } from '../profile/index.js';
```

**Step 2: Add ProfileManager to MemoryManager**

Add field to class:

```typescript
private profileManager: ProfileManager;
```

Update constructor:

```typescript
constructor(baseDir: string = '.memory') {
  this.shortTerm = new ShortTermMemory(`${baseDir}/short-term`);
  this.working = new WorkingMemory(`${baseDir}/working`);
  this.longTerm = new LongTermMemory(`${baseDir}/long-term`);
  this.profileManager = new ProfileManager(`${baseDir}/profiles`);
}
```

Update initialize method:

```typescript
async initialize(): Promise<void> {
  await this.shortTerm.initialize();
  await this.working.initialize();
  await this.longTerm.initialize();
  await this.profileManager.initialize();

  // Load active profile into LongTermMemory
  const activeProfile = this.profileManager.getActiveProfile();
  if (activeProfile) {
    this.syncProfileToLongTerm(activeProfile);
  }
}
```

Add helper methods:

```typescript
getProfileManager(): ProfileManager {
  return this.profileManager;
}

private syncProfileToLongTerm(profile: any): void {
  // Update LongTerm profile
  this.longTerm['profile'] = {
    style: {
      responseLength: profile.responseStyle,
      tone: profile.tone,
      language: 'russian',
    },
    preferences: {
      stack: profile.stack,
      frameworks: [],
    },
  };

  // Update LongTerm constraints
  this.longTerm['constraints'] = profile.constraints;
}

async switchProfile(name: string): Promise<boolean> {
  const success = await this.profileManager.switchProfile(name);

  if (success) {
    const profile = this.profileManager.getActiveProfile();
    if (profile) {
      this.syncProfileToLongTerm(profile);
    }
  }

  return success;
}
```

**Step 3: Verify TypeScript compilation**

Run: `npm run build`
Expected: No compilation errors

**Step 4: Commit**

```bash
git add src/memory/MemoryManager.ts
git commit -m "feat(memory): integrate ProfileManager with MemoryManager

- Add ProfileManager to MemoryManager
- Sync active profile to LongTermMemory on init
- Add switchProfile method for profile changes"
```

---

## Task 6: Update Conversation to Build System Prompt with Profile

**Files:**
- Modify: `src/chat/conversation.ts`

**Step 1: Find buildSystemPromptWithMemory method**

Locate the method (around line 150-180). If it doesn't exist, find where system prompt is built.

**Step 2: Update method to include profile context**

```typescript
buildSystemPromptWithMemory(basePrompt?: string): string {
  const context = this.memoryManager.getContextForPrompt();
  const profile = this.memoryManager.getProfileManager().getActiveProfile();

  let systemPrompt = basePrompt || '';

  // Add profile personalization
  if (profile) {
    systemPrompt += '\n\n=== ПЕРСОНАЛИЗАЦИЯ ===\n';
    systemPrompt += `Стиль ответов: ${profile.responseStyle}\n`;
    systemPrompt += `Тон: ${profile.tone}\n`;
    systemPrompt += `Примеры кода: ${profile.includeCodeExamples ? 'включать' : 'не включать'}\n`;
    systemPrompt += `Уровень детализации: ${profile.detailLevel}\n`;
    systemPrompt += `Контекст работы: ${profile.context.purpose}\n`;

    if (profile.stack.length > 0) {
      systemPrompt += `Технологический стек: ${profile.stack.join(', ')}\n`;
    }

    if (profile.preferredLanguage) {
      systemPrompt += `Предпочитаемый язык: ${profile.preferredLanguage}\n`;
    }

    // Add constraints
    if (profile.constraints.forbidden.length > 0) {
      systemPrompt += `\nЗАПРЕЩЕНО: ${profile.constraints.forbidden.join(', ')}\n`;
    }

    if (profile.constraints.required.length > 0) {
      systemPrompt += `ОБЯЗАТЕЛЬНО: ${profile.constraints.required.join(', ')}\n`;
    }

    if (profile.constraints.rules.length > 0) {
      systemPrompt += '\nПРАВИЛА:\n';
      profile.constraints.rules.forEach(rule => {
        systemPrompt += `- ${rule}\n`;
      });
    }
  }

  // Add memory context
  if (context.longTerm.profile) {
    // ... existing memory context code
  }

  return systemPrompt;
}
```

**Step 3: Verify TypeScript compilation**

Run: `npm run build`
Expected: No compilation errors

**Step 4: Commit**

```bash
git add src/chat/conversation.ts
git commit -m "feat(conversation): include profile in system prompt

- Add profile personalization to system prompt
- Include style, tone, examples preference
- Add context purpose and tech stack
- Include constraints (forbidden, required, rules)"
```

---

## Task 7: Add Profile Commands to Chat

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add profile state**

Add to component state (near line 100):

```typescript
const [interviewMode, setInterviewMode] = useState(false);
const [interviewStep, setInterviewStep] = useState(0);
const [interviewAnswers, setInterviewAnswers] = useState<Record<string, any>>({});
```

**Step 2: Add profile commands handler**

Add before `return false` in `handleCommand` function (around line 710):

```typescript
// Profile commands
if (trimmed.startsWith('/profile')) {
  const parts = trimmed.split(' ').filter(Boolean);

  if (parts.length === 1 || parts[1] === 'show') {
    const profile = conversation.getMemoryManager().getProfileManager().getActiveProfile();

    if (!profile) {
      setNotification('❌ Нет активного профиля');
      return true;
    }

    let output = '\n👤 АКТИВНЫЙ ПРОФИЛЬ:\n\n';
    output += `Имя: ${profile.name}\n`;
    output += `Стиль: ${profile.responseStyle}\n`;
    output += `Тон: ${profile.tone}\n`;
    output += `Примеры кода: ${profile.includeCodeExamples ? 'да' : 'нет'}\n`;
    output += `Детализация: ${profile.detailLevel}\n`;
    output += `Контекст: ${profile.context.purpose}\n`;

    if (profile.stack.length > 0) {
      output += `Стек: ${profile.stack.join(', ')}\n`;
    }

    if (profile.preferredLanguage) {
      output += `Язык: ${profile.preferredLanguage}\n`;
    }

    setNotification(output);
    return true;
  }

  if (parts[1] === 'list') {
    const profiles = await conversation.getMemoryManager().getProfileManager().listProfiles();
    const activeProfile = conversation.getMemoryManager().getProfileManager().getActiveProfile();

    if (profiles.length === 0) {
      setNotification('Нет созданных профилей');
      return true;
    }

    let output = '\n📋 ПРОФИЛИ:\n\n';
    profiles.forEach((meta, index) => {
      const active = meta.name === activeProfile?.name ? ' ← активный' : '';
      output += `${index + 1}. ${meta.name}${active}\n`;
      output += `   Создан: ${new Date(meta.createdAt).toLocaleString('ru-RU')}\n`;
    });

    setNotification(output);
    return true;
  }

  if (parts[1] === 'switch') {
    if (parts.length < 3) {
      setNotification('Использование: /profile switch <имя>');
      return true;
    }

    const name = parts.slice(2).join(' ');
    const success = await conversation.getMemoryManager().switchProfile(name);

    if (success) {
      setNotification(`✓ Профиль переключен на "${name}"`);
    } else {
      setNotification(`❌ Профиль "${name}" не найден`);
    }

    return true;
  }

  if (parts[1] === 'delete') {
    if (parts.length < 3) {
      setNotification('Использование: /profile delete <имя>');
      return true;
    }

    const name = parts.slice(2).join(' ');
    const success = await conversation.getMemoryManager().getProfileManager().deleteProfile(name);

    if (success) {
      setNotification(`✓ Профиль "${name}" удален`);
    } else {
      setNotification('❌ Не удалось удалить профиль (активный или последний)');
    }

    return true;
  }

  if (parts[1] === 'create') {
    setNotification('🎤 Начинаем интервью для создания профиля...\n(Введите "skip" для пропуска вопроса, если доступно)');
    setInterviewMode(true);
    setInterviewStep(0);
    setInterviewAnswers({});
    return true;
  }

  setNotification('Команды: /profile show | list | switch <имя> | delete <имя> | create');
  return true;
}
```

**Step 3: Add interview mode handling**

Add after command handling in `useInput` hook (around line 930):

```typescript
// Handle interview mode
if (interviewMode) {
  if (key.return && input.trim()) {
    const interviewFlow = new InterviewFlow();
    const questions = interviewFlow.getQuestions();
    const currentQuestion = questions[interviewStep];

    const answer = interviewFlow.parseAnswer(currentQuestion, input.trim());
    const newAnswers = { ...interviewAnswers, [currentQuestion.id]: answer };
    setInterviewAnswers(newAnswers);
    setInput('');

    // Move to next question
    if (interviewStep < questions.length - 1) {
      setInterviewStep(interviewStep + 1);
      const nextQuestion = questions[interviewStep + 1];
      setNotification(
        `Вопрос ${interviewStep + 2}/${questions.length}:\n${nextQuestion.question}\n` +
        (nextQuestion.options ? nextQuestion.options.join('\n') : '')
      );
    } else {
      // Interview complete
      const validation = interviewFlow.validateAnswers(newAnswers);

      if (!validation.valid) {
        setNotification(`❌ Ошибка: ${validation.errors.join(', ')}`);
        setInterviewMode(false);
        return;
      }

      const profile = interviewFlow.buildProfile(newAnswers);
      await conversation.getMemoryManager().getProfileManager().createProfile(profile);
      await conversation.getMemoryManager().switchProfile(profile.name);

      setNotification(`✓ Профиль "${profile.name}" создан и активирован!`);
      setInterviewMode(false);
      setInterviewStep(0);
      setInterviewAnswers({});
    }

    return;
  }
  return; // Don't process other input in interview mode
}
```

**Step 4: Add import for InterviewFlow**

Add at top of file:

```typescript
import { InterviewFlow } from '../profile/index.js';
```

**Step 5: Update help text**

Find help text section and update `/profile` line (around line 1096):

```typescript
<Text dimColor>
  <Text color="yellow">/profile show/list/create</Text> - управление профилями | <Text color="yellow">/profile switch/delete</Text>
</Text>
```

**Step 6: Verify TypeScript compilation**

Run: `npm run build`
Expected: No compilation errors

**Step 7: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): add profile management commands

- /profile show - display active profile
- /profile list - list all profiles
- /profile switch - change active profile
- /profile delete - remove profile
- /profile create - interactive interview
- Interview mode with step-by-step questions"
```

---

## Task 8: Add Interview on First Startup

**Files:**
- Modify: `src/components/Chat.tsx`

**Step 1: Add initialization effect**

Add useEffect after existing effects (around line 1020):

```typescript
// Check for profiles on startup
useEffect(() => {
  const checkProfiles = async () => {
    const profileManager = conversation.getMemoryManager().getProfileManager();
    const hasProfiles = await profileManager.hasProfiles();

    if (!hasProfiles) {
      setNotification(
        '👋 Добро пожаловать! Давайте настроим ваш профиль.\n\n' +
        'Начинаем интервью...\n' +
        '(Вы можете пропустить интервью, введя "skip" на первом вопросе)\n\n' +
        'Вопрос 1: Как назовем этот профиль?'
      );
      setInterviewMode(true);
      setInterviewStep(0);
    }
  };

  checkProfiles().catch(err => {
    console.error('Failed to check profiles:', err);
  });
}, []);
```

**Step 2: Handle skip on first question**

Update interview handling to detect global skip:

```typescript
// In interview mode handler, after parseAnswer:
if (interviewStep === 0 && input.trim().toLowerCase() === 'skip') {
  // Create default profile
  const defaultProfile = profileManager.createDefaultProfile();
  await profileManager.createProfile(defaultProfile);
  await conversation.getMemoryManager().switchProfile(defaultProfile.name);

  setNotification('✓ Создан профиль по умолчанию. Можете начать работу!');
  setInterviewMode(false);
  setInput('');
  return;
}
```

**Step 3: Verify TypeScript compilation**

Run: `npm run build`
Expected: No compilation errors

**Step 4: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): add profile interview on first startup

- Auto-start interview if no profiles exist
- Allow skip to create default profile
- Welcome message with instructions"
```

---

## Task 9: Manual Testing

**Files:**
- N/A (manual testing)

**Step 1: Test first startup interview**

```bash
# Remove profiles
rm -rf .memory/profiles

# Start app
npm start

# Expected: Interview starts automatically
# Answer questions or type 'skip' on first question
```

Expected output:
- Interview questions appear
- Profile is created
- Agent starts with personalized settings

**Step 2: Test profile switching**

```bash
# In running app:
/profile create
# Create profile named "краткий" with краткий style

# Ask question
"Что такое замыкание?"

# Switch profile
/profile switch default

# Ask same question
"Что такое замыкание?"

# Expected: Different response styles
```

**Step 3: Test profile commands**

```bash
/profile list      # Shows all profiles
/profile show      # Shows active profile details
/profile delete краткий   # Deletes profile
```

**Step 4: Test constraints**

```bash
/profile create
# Name: python-dev
# Stack: Python, Django

# Ask: "Напиши сортировку массива"
# Expected: Python code, mentions Django if relevant
```

**Step 5: Document test results**

Create `docs/testing/day12-manual-tests.md` with results.

**Step 6: Commit**

```bash
git add docs/testing/day12-manual-tests.md
git commit -m "docs: add Day 12 manual test results"
```

---

## Task 10: Update README

**Files:**
- Modify: `README.md`

**Step 1: Add profile section**

Add after existing commands section:

```markdown
## Управление профилями

Агент поддерживает множественные профили пользователей для персонализации ответов.

### Первый запуск

При первом запуске без профилей автоматически запускается интервью:
- Ответьте на вопросы о предпочтениях
- Или введите "skip" для создания профиля по умолчанию

### Команды профилей

- `/profile show` - показать активный профиль
- `/profile list` - список всех профилей
- `/profile create` - создать новый профиль (интервью)
- `/profile switch <имя>` - переключить активный профиль
- `/profile delete <имя>` - удалить профиль

### Настройки профиля

Каждый профиль содержит:
- **Стиль**: краткий или подробный
- **Тон**: формальный или разговорный
- **Примеры кода**: включать или нет
- **Контекст**: цель использования агента
- **Стек**: предпочитаемые технологии
- **Ограничения**: запрещенные/обязательные элементы

### Пример

```bash
# Создать профиль для JS разработки
/profile create
# Имя: js-dev
# Стиль: краткий
# Стек: TypeScript, React, Node.js

# Все ответы будут адаптированы под этот профиль
```
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add profile management to README

- Document first-time interview
- List profile commands
- Explain profile settings
- Add usage example"
```

---

## Summary

**Total Tasks:** 10
**Estimated Time:** 2-3 hours
**Files Created:** 4 (types, ProfileManager, InterviewFlow, index)
**Files Modified:** 3 (MemoryManager, Conversation, Chat)

**Key Features Implemented:**
✅ Multiple user profiles
✅ Interactive interview for profile creation
✅ Profile switching with live effect
✅ Profile data injected into system prompt
✅ Constraints validation
✅ Auto-interview on first startup
✅ Complete CLI commands

**Testing Coverage:**
- First startup interview
- Profile creation and switching
- Different response styles per profile
- Constraints application
- All profile commands
