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

export async function rewriteQuery(question: string, model: string): Promise<string> {
  const systemPrompt =
    'Перефразируй запрос для семантического поиска по технической документации.\n' +
    'Верни только переформулированный запрос, без пояснений.';
  try {
    const response = await sendMessage(
      [{ role: 'user', content: question }],
      model,
      systemPrompt,
    );
    return response.content.trim();
  } catch (err) {
    console.error('[rewriteQuery] LLM error, using original query:', err);
    return question;
  }
}

import { filterByThreshold, DEFAULT_FILTER_OPTIONS } from './reranker.js';
import type { FilterOptions } from './reranker.js';

export interface RagAnswerEnhanced extends RagAnswer {
  rewrittenQuery?: string;
  chunksBeforeFilter: number;
  chunksAfterFilter: number;
}

export async function ragQueryEnhanced(
  question: string,
  ragManager: RagManager,
  model: string,
  options: { withFilter: boolean; withRewrite: boolean } & Partial<FilterOptions>,
): Promise<RagAnswerEnhanced> {
  const resolved = {
    ...DEFAULT_FILTER_OPTIONS,
    withFilter: options.withFilter,
    withRewrite: options.withRewrite,
    ...(options.threshold !== undefined && { threshold: options.threshold }),
    ...(options.topKInitial !== undefined && { topKInitial: options.topKInitial }),
    ...(options.topKFinal !== undefined && { topKFinal: options.topKFinal }),
  };

  let searchQuery = question;
  let rewrittenQuery: string | undefined;

  if (resolved.withRewrite) {
    rewrittenQuery = await rewriteQuery(question, model);
    searchQuery = rewrittenQuery;
  }

  const results = await ragManager.search(searchQuery, 'structural', resolved.topKInitial);
  const chunksBeforeFilter = results.length;

  let filtered = resolved.withFilter
    ? filterByThreshold(results, resolved.threshold)
    : results;
  filtered = filtered.slice(0, resolved.topKFinal);
  const chunksAfterFilter = filtered.length;

  const systemPrompt = buildRagSystemPrompt(filtered);
  const messages = [{ role: 'user' as const, content: question }];
  const apiResponse = await sendMessage(messages, model, systemPrompt);

  const sources: Source[] = filtered.map((r) => ({
    title: r.chunk.title,
    section: r.chunk.section,
    score: r.score,
  }));

  return {
    answer: apiResponse.content,
    sources,
    rewrittenQuery,
    chunksBeforeFilter,
    chunksAfterFilter,
  };
}
