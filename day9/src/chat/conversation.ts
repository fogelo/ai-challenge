import { Message, SessionStats, SessionData, MessageMetadata } from '../types/index.js';
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

  addAssistantMessage(content: string, metadata?: MessageMetadata): void {
    this.messages.push({
      role: 'assistant',
      content,
      metadata
    });
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
