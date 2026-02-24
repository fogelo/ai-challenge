import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SessionData, SessionMetadata } from '../types/index.js';

export class SessionManager {
  private historyDir: string;

  constructor(historyDir: string = '.chat-history') {
    this.historyDir = historyDir;
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
  }

  private generateSessionId(): string {
    return crypto.randomBytes(4).toString('hex');
  }

  private getSessionFileName(sessionId: string, timestamp?: string): string {
    const ts = timestamp || new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    return `session-${ts}-${sessionId}.json`;
  }

  private getSessionFilePath(fileName: string): string {
    return path.join(this.historyDir, fileName);
  }

  createSession(): string {
    const sessionId = this.generateSessionId();
    const fileName = this.getSessionFileName(sessionId);
    const filePath = this.getSessionFilePath(fileName);

    const initialData: SessionData = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      stats: {
        totalTokens: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCost: 0,
        requestCount: 0,
      },
    };

    try {
      fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2), 'utf-8');
      return sessionId;
    } catch (error) {
      console.error('Error creating session:', error);
      throw error;
    }
  }

  saveSession(sessionId: string, data: SessionData): void {
    try {
      // Find the file for this session ID
      const files = fs.readdirSync(this.historyDir);
      const sessionFile = files.find(file => file.includes(sessionId));

      if (!sessionFile) {
        throw new Error(`Session file not found for ID: ${sessionId}`);
      }

      const filePath = this.getSessionFilePath(sessionFile);
      data.updatedAt = new Date().toISOString();

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Error saving session ${sessionId}:`, error);
      // Don't throw - we don't want to crash the app on save failure
    }
  }

  loadSession(sessionId: string): SessionData | null {
    try {
      const files = fs.readdirSync(this.historyDir);
      const sessionFile = files.find(file => file.includes(sessionId));

      if (!sessionFile) {
        console.error(`Session file not found for ID: ${sessionId}`);
        return null;
      }

      const filePath = this.getSessionFilePath(sessionFile);
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as SessionData;

      return data;
    } catch (error) {
      console.error(`Error loading session ${sessionId}:`, error);
      return null;
    }
  }

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

            return {
              id: data.id,
              fileName: fileName,
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
              messageCount: data.messages.length,
            };
          } catch (error) {
            console.error(`Error reading session file ${fileName}:`, error);
            return null;
          }
        })
        .filter((session): session is SessionMetadata => session !== null);

      // Sort by creation date, newest first
      sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return sessions;
    } catch (error) {
      console.error('Error listing sessions:', error);
      return [];
    }
  }

  deleteSession(sessionId: string): boolean {
    try {
      const files = fs.readdirSync(this.historyDir);
      const sessionFile = files.find(file => file.includes(sessionId));

      if (!sessionFile) {
        return false;
      }

      const filePath = this.getSessionFilePath(sessionFile);
      fs.unlinkSync(filePath);
      return true;
    } catch (error) {
      console.error(`Error deleting session ${sessionId}:`, error);
      return false;
    }
  }
}
