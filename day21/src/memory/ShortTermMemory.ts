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
