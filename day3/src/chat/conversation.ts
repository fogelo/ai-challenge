import { Message } from '../types/index.js';

export class Conversation {
  private messages: Message[] = [];

  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content });
  }

  addAssistantMessage(content: string): void {
    this.messages.push({ role: 'assistant', content });
  }

  getHistory(): Message[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }
}
