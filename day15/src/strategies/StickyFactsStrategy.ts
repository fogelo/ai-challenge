import { IContextStrategy } from './IContextStrategy.js';
import { Message, StickyFactsState } from '../types/index.js';
import { sendMessage } from '../api/openrouter.js';

/**
 * Sticky Facts strategy: extracts key facts + keeps recent N messages
 */
export class StickyFactsStrategy implements IContextStrategy {
  private messages: Message[] = [];
  private facts: Record<string, string> = {};
  private windowSize: number;
  private extractionModel: string | null;
  private lastFactsUpdate: number = 0;

  constructor(windowSize: number = 10, extractionModel: string | null = null) {
    this.windowSize = windowSize;
    this.extractionModel = extractionModel;
  }

  async addMessage(message: Message): Promise<void> {
    this.messages.push(message);

    // Extract facts after user messages
    if (message.role === 'user') {
      await this.extractFacts();
    }
  }

  private async extractFacts(): Promise<void> {
    try {
      const extractionPrompt = `Проанализируй диалог и извлеки ключевые факты в JSON формате.
Ключи: goal, constraints, preferences, decisions, agreements, context.
Верни только JSON без дополнительного текста.`;

      // Use last 5 messages for context
      const contextMessages = this.messages.slice(-5);

      const response = await sendMessage(
        [
          { role: 'system', content: extractionPrompt },
          ...contextMessages,
        ],
        this.extractionModel || process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet'
      );

      // Parse and merge facts
      const newFacts = JSON.parse(response.content);
      this.facts = { ...this.facts, ...newFacts };
      this.lastFactsUpdate = Date.now();
    } catch (error) {
      // Graceful degradation - continue without updating facts
      console.error('Failed to extract facts:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async getMessagesForAPI(): Promise<Message[]> {
    const result: Message[] = [];

    // Add facts as system message if we have any
    if (Object.keys(this.facts).length > 0) {
      result.push({
        role: 'system',
        content: `Важные факты из диалога:\n${JSON.stringify(this.facts, null, 2)}`,
      });
    }

    // Add recent messages
    result.push(...this.messages.slice(-this.windowSize));

    return result;
  }

  clear(): void {
    this.messages = [];
    this.facts = {};
    this.lastFactsUpdate = 0;
  }

  getName(): string {
    return 'Sticky Facts';
  }

  serialize(): StickyFactsState {
    return {
      type: 'facts',
      messages: this.messages,
      facts: this.facts,
      windowSize: this.windowSize,
      lastFactsUpdate: this.lastFactsUpdate,
    };
  }

  restore(state: StickyFactsState): void {
    if (state.type !== 'facts') {
      throw new Error('Invalid state type for StickyFactsStrategy');
    }
    this.messages = state.messages;
    this.facts = state.facts;
    this.windowSize = state.windowSize;
    this.lastFactsUpdate = state.lastFactsUpdate;
  }

  getFacts(): Record<string, string> {
    return { ...this.facts };
  }

  getWindowSize(): number {
    return this.windowSize;
  }

  setWindowSize(size: number): void {
    if (size <= 0) {
      throw new Error('Window size must be positive');
    }
    this.windowSize = size;
  }
}
