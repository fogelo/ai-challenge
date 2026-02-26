import { Message, SessionStats, SessionData, MessageMetadata } from '../types/index.js';
import { SessionManager } from './session.js';

export class Conversation {
  private messages: Message[] = [];
  private sessionManager: SessionManager;
  private currentSessionId: string;
  private summary: string | null = null;
  private needsSummarizationFlag: boolean = false;

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

  getMessagesForAPI(keepRecentMessages: number): Message[] {
    if (this.summary) {
      // If we have a summary, return summary + recent messages
      const recent = this.messages.slice(-keepRecentMessages);
      return [
        { role: 'system', content: this.summary },
        ...recent,
      ];
    }
    // No summary, return all messages
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
    this.summary = null;
    this.needsSummarizationFlag = false;
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
}
