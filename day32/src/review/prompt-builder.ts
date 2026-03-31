import type { SearchResult } from '../rag/types.js';
import type { FileDiff } from './diff-parser.js';

const MAX_FILE_CHARS = 2000;

export interface PromptParts {
  systemPrompt: string;
  userPrompt: string;
}

export function buildReviewPrompt(
  fileDiffs: FileDiff[],
  fileContents: Map<string, string>,
  ragResults: SearchResult[],
): PromptParts {
  const ragContext =
    ragResults.length > 0
      ? ragResults.map((r) => r.chunk.text).join('\n---\n')
      : 'No documentation context available.';

  const fileSection = fileDiffs
    .map(({ path }) => {
      const content = fileContents.get(path) ?? '(file not readable)';
      const truncated =
        content.length > MAX_FILE_CHARS
          ? content.slice(0, MAX_FILE_CHARS) + '\n... (truncated)'
          : content;
      return `### ${path}\n\`\`\`\n${truncated}\n\`\`\``;
    })
    .join('\n\n');

  const diffSection = fileDiffs
    .map(({ path, hunks }) => `### ${path}\n\`\`\`diff\n${hunks}\n\`\`\``)
    .join('\n\n');

  const systemPrompt =
    `You are an expert code reviewer. Analyze the provided git diff and return a JSON object with exactly these keys:\n` +
    `- "bugs": array of strings describing potential bugs or runtime errors\n` +
    `- "architectural_issues": array of strings describing design or architecture problems\n` +
    `- "recommendations": array of strings with improvement suggestions\n\n` +
    `Return ONLY valid JSON, no markdown fences, no extra text.\n\n` +
    `Project documentation context:\n${ragContext}`;

  const userPrompt =
    `Review this pull request.\n\n` +
    `## Changed Files (full content)\n${fileSection}\n\n` +
    `## Diff\n${diffSection}`;

  return { systemPrompt, userPrompt };
}
