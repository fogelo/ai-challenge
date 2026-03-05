import { IContextStrategy } from './IContextStrategy.js';
import { Message, SlidingWindowState } from '../types/index.js';

/**
 * Sliding Window strategy: keeps only the last N messages
 */
export class SlidingWindowStrategy implements IContextStrategy {
  private messages: Message[] = [];
  private windowSize: number;

  constructor(windowSize: number = 10) {
    this.windowSize = windowSize;
  }

  async getMessagesForAPI(): Promise<Message[]> {
    // Return only the last windowSize messages
    return this.messages.slice(-this.windowSize);
  }

  async addMessage(message: Message): Promise<void> {
    this.messages.push(message);
  }

  clear(): void {
    this.messages = [];
  }

  getName(): string {
    return 'Sliding Window';
  }

  serialize(): SlidingWindowState {
    return {
      type: 'sliding',
      messages: this.messages,
      windowSize: this.windowSize,
    };
  }

  restore(state: SlidingWindowState): void {
    if (state.type !== 'sliding') {
      throw new Error('Invalid state type for SlidingWindowStrategy');
    }
    this.messages = state.messages;
    this.windowSize = state.windowSize;
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
