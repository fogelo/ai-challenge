import fs from 'fs/promises';
import type { SearchResult } from './types.js';
import { sendMessage } from '../api/openrouter.js';
import type { RagManager } from './RagManager.js';

export interface Source {
  title: string;
  section: string;
  score: number;
}

export interface RagAnswer {
  answer: string;
  sources: Source[];
}

export interface ControlQuestion {
  question: string;
  expectedAnswer: string;
  expectedSources: string[];
}

export interface RagTestResult {
  controlQuestion: ControlQuestion;
  answerWithoutRag: string;
  answerWithRag: string;
  sources: Source[];
}

export function buildRagSystemPrompt(results: SearchResult[]): string {
  const contextBlocks = results.map((r) => r.chunk.text).join('\n---\n');
  return (
    'Ты — ассистент по архитектуре ПО. Отвечай ТОЛЬКО на основе предоставленного контекста.\n' +
    'Если ответа нет в контексте — честно скажи об этом.\n' +
    'Не придумывай информацию, которой нет в источниках.\n\n' +
    'Контекст:\n' +
    contextBlocks
  );
}

export async function ragQuery(
  question: string,
  ragManager: RagManager,
  model: string,
): Promise<RagAnswer> {
  const results = await ragManager.search(question, 'structural', 5);
  const systemPrompt = buildRagSystemPrompt(results);
  const messages = [{ role: 'user' as const, content: question }];
  const apiResponse = await sendMessage(messages, model, systemPrompt);
  const sources: Source[] = results.map((r) => ({
    title: r.chunk.title,
    section: r.chunk.section,
    score: r.score,
  }));
  return { answer: apiResponse.content, sources };
}

export async function loadControlQuestions(resolvedPath: string): Promise<ControlQuestion[]> {
  const raw = await fs.readFile(resolvedPath, 'utf-8');
  return JSON.parse(raw) as ControlQuestion[];
}
