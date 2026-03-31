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
    `Ты — эксперт по ревью кода. Проанализируй предоставленный git diff и верни JSON объект со следующими ключами:\n` +
    `- "bugs": массив строк с описанием потенциальных багов или ошибок времени выполнения\n` +
    `- "architectural_issues": массив строк с описанием архитектурных или дизайн-проблем\n` +
    `- "recommendations": массив строк с рекомендациями по улучшению\n\n` +
    `Верни ТОЛЬКО валидный JSON, без markdown-оберток и лишнего текста. Все строки в массивах — на русском языке.\n\n` +
    `Контекст документации проекта:\n${ragContext}`;

  const userPrompt =
    `Сделай ревью этого pull request.\n\n` +
    `## Changed Files (full content)\n${fileSection}\n\n` +
    `## Diff\n${diffSection}`;

  return { systemPrompt, userPrompt };
}
