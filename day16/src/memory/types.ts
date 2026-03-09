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
