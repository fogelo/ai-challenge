import { Message, SessionStats, SessionData, MessageMetadata, StrategyState } from '../types/index.js';
import { SessionManager } from './session.js';
import {
  IContextStrategy,
  SlidingWindowStrategy,
  StickyFactsStrategy,
  BranchingStrategy,
} from '../strategies/index.js';
import { MemoryManager } from '../memory/index.js';

export class Conversation {
  private messages: Message[] = [];
  private sessionManager: SessionManager;
  private currentSessionId: string;
  private summary: string | null = null;
  private needsSummarizationFlag: boolean = false;
  private strategy: IContextStrategy;
  private allMessages: Message[] = [];  // Keep full history for backup
  private memoryManager: MemoryManager;

  constructor(sessionManager: SessionManager, strategy?: IContextStrategy) {
    this.sessionManager = sessionManager;
    this.currentSessionId = sessionManager.createSession();
    this.strategy = strategy || new SlidingWindowStrategy(10);
    this.memoryManager = new MemoryManager();
  }

  async initialize(): Promise<void> {
    await this.memoryManager.initialize();
  }

  getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }

  async addUserMessage(content: string): Promise<void> {
    const message: Message = { role: 'user', content };
    this.messages.push(message);
    this.allMessages.push(message);
    await this.strategy.addMessage(message);
    this.memoryManager.getShortTerm().addMessage(message);
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
    this.memoryManager.getShortTerm().addMessage(message);
  }

  getHistory(): Message[] {
    return [...this.messages];
  }

  async getMessagesForAPI(): Promise<Message[]> {
    // Delegate to strategy
    return await this.strategy.getMessagesForAPI();
  }

  setStrategy(strategy: IContextStrategy): void {
    this.strategy = strategy;
    // Transfer all messages to new strategy
    this.allMessages.forEach(msg => this.strategy.addMessage(msg));
  }

  getStrategy(): IContextStrategy {
    return this.strategy;
  }

  getStrategyName(): string {
    return this.strategy.getName();
  }

  getCurrentSessionId(): string {
    return this.currentSessionId;
  }

  saveSession(stats: SessionStats): void {
    const currentTask = this.memoryManager.getTaskStateMachine().getCurrentTask();

    const data: SessionData = {
      id: this.currentSessionId,
      createdAt: new Date().toISOString(), // Will be overwritten by actual createdAt on load
      updatedAt: new Date().toISOString(),
      messages: this.messages,
      summary: this.summary ?? undefined,
      needsSummarization: this.needsSummarizationFlag,
      stats: stats,
      strategyState: this.strategy.serialize(),
      taskStateId: currentTask?.taskId,
    };

    this.sessionManager.saveSession(this.currentSessionId, data);
  }

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

    // Restore task state
    if (data.taskStateId) {
      this.memoryManager.getTaskStateMachine().load(data.taskStateId);
    }

    return { success: true, stats: data.stats };
  }

  private createStrategyFromState(state: StrategyState): IContextStrategy {
    switch (state.type) {
      case 'sliding': {
        const strategy = new SlidingWindowStrategy(state.windowSize);
        strategy.restore(state);
        return strategy;
      }
      case 'facts': {
        const strategy = new StickyFactsStrategy(state.windowSize);
        strategy.restore(state);
        return strategy;
      }
      case 'branching': {
        const strategy = new BranchingStrategy();
        strategy.restore(state);
        return strategy;
      }
    }
  }

  clear(): void {
    this.messages = [];
    this.allMessages = [];
    this.summary = null;
    this.needsSummarizationFlag = false;
    this.strategy.clear();
    // Create new session after clear
    this.currentSessionId = this.sessionManager.createSession();
  }

  listSessions() {
    return this.sessionManager.listSessions();
  }

  setSummary(summary: string): void {
    this.summary = summary;
  }

  getSummary(): string | null {
    return this.summary;
  }

  setNeedsSummarization(value: boolean): void {
    this.needsSummarizationFlag = value;
  }

  needsSummarization(): boolean {
    return this.needsSummarizationFlag;
  }

  buildSystemPromptWithMemory(basePrompt?: string): string {
    const context = this.memoryManager.getContextForPrompt();
    const profile = this.memoryManager.getProfileManager().getActiveProfile();
    let prompt = basePrompt || 'Ты полезный AI ассистент.\n\n';

    // Add profile personalization
    if (profile) {
      prompt += '=== ПЕРСОНАЛИЗАЦИЯ ===\n';
      prompt += `Стиль ответов: ${profile.responseStyle}\n`;
      prompt += `Тон: ${profile.tone}\n`;
      prompt += `Примеры кода: ${profile.includeCodeExamples ? 'включать' : 'не включать'}\n`;
      prompt += `Уровень детализации: ${profile.detailLevel}\n`;
      prompt += `Контекст работы: ${profile.context.purpose}\n`;

      if (profile.stack.length > 0) {
        prompt += `Технологический стек: ${profile.stack.join(', ')}\n`;
      }

      if (profile.preferredLanguage) {
        prompt += `Предпочитаемый язык: ${profile.preferredLanguage}\n`;
      }

      // Add constraints
      if (profile.constraints.forbidden.length > 0) {
        prompt += `\nЗАПРЕЩЕНО: ${profile.constraints.forbidden.join(', ')}\n`;
      }

      if (profile.constraints.required.length > 0) {
        prompt += `ОБЯЗАТЕЛЬНО: ${profile.constraints.required.join(', ')}\n`;
      }

      if (profile.constraints.rules.length > 0) {
        prompt += '\nПРАВИЛА:\n';
        profile.constraints.rules.forEach(rule => {
          prompt += `- ${rule}\n`;
        });
      }
      prompt += '\n';
    }

    // Add profile from memory context (legacy)
    if (context.longTerm.profile.preferences.stack.length > 0) {
      prompt += `# Профиль пользователя\n`;
      prompt += `Предпочитаемый стек: ${context.longTerm.profile.preferences.stack.join(', ')}\n`;
      if (context.longTerm.profile.preferences.frameworks.length > 0) {
        prompt += `Фреймворки: ${context.longTerm.profile.preferences.frameworks.join(', ')}\n`;
      }
      prompt += `Стиль ответов: ${context.longTerm.profile.style.responseLength}\n`;
      prompt += `Тон: ${context.longTerm.profile.style.tone}\n\n`;
    }

    // Task state prompt injection
    const taskStatePrompt = this.memoryManager.getTaskStateMachine().getStatePrompt();
    if (taskStatePrompt) {
      prompt += taskStatePrompt + '\n';
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
