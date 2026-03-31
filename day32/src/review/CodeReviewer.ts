import { readFile } from 'fs/promises';
import { join } from 'path';
import { parseDiff } from './diff-parser.js';
import { buildReviewPrompt } from './prompt-builder.js';
import { sendMessage } from '../api/openrouter.js';
import type { RagManager } from '../rag/RagManager.js';
import type { SearchResult } from '../rag/types.js';

export interface ReviewResult {
  bugs: string[];
  architectural_issues: string[];
  recommendations: string[];
}

export class CodeReviewer {
  constructor(
    private readonly ragManager: RagManager,
    private readonly model: string,
  ) {}

  async review(diff: string, repoPath: string): Promise<ReviewResult> {
    const parsed = parseDiff(diff);

    if (parsed.files.length === 0) {
      return { bugs: [], architectural_issues: [], recommendations: ['No changes detected.'] };
    }

    const fileContents = new Map<string, string>();
    const readResults = await Promise.allSettled(
      parsed.files.map((fp) => readFile(join(repoPath, fp), 'utf-8')),
    );
    for (const [i, result] of readResults.entries()) {
      const fp = parsed.files[i];
      fileContents.set(fp, result.status === 'fulfilled' ? result.value : '(could not read file)');
    }

    let ragResults: SearchResult[] = [];
    try {
      ragResults = await this.ragManager.search(parsed.summary, 'structural', 6);
    } catch (err) {
      console.warn(
        '[CodeReviewer] RAG search failed, proceeding without context:',
        err instanceof Error ? err.message : err,
      );
    }

    const { systemPrompt, userPrompt } = buildReviewPrompt(
      parsed.fileDiffs,
      fileContents,
      ragResults,
    );

    const response = await sendMessage(
      [{ role: 'user', content: userPrompt }],
      this.model,
      systemPrompt,
    );

    return this.parseReviewResult(response.content);
  }

  private parseReviewResult(raw: string): ReviewResult {
    try {
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const cleaned = (fenceMatch ? fenceMatch[1] : raw).trim();
      const parsed = JSON.parse(cleaned) as ReviewResult;
      return {
        bugs: Array.isArray(parsed.bugs) ? parsed.bugs : [],
        architectural_issues: Array.isArray(parsed.architectural_issues)
          ? parsed.architectural_issues
          : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      };
    } catch {
      return {
        bugs: [],
        architectural_issues: [],
        recommendations: [raw],
      };
    }
  }
}
