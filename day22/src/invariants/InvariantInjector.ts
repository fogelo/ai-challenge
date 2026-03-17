// src/invariants/InvariantInjector.ts

import { InvariantSet, InvariantCategory } from './types.js';

export class InvariantInjector {
  formatForPrompt(invariants: InvariantSet): string | null {
    const categories = Object.entries(invariants.invariants);

    if (categories.length === 0) {
      return null;
    }

    const formatted = categories
      .map(([category, data]) => this.formatCategory(category, data))
      .join('\n\n');

    return `## ИНВАРИАНТЫ ПРОЕКТА\n\nЭто жесткие ограничения проекта, которые НЕЛЬЗЯ нарушать.\n\n${formatted}`;
  }

  private formatCategory(name: string, category: InvariantCategory): string {
    const priority = category.type === 'hard' ? 'КРИТИЧНО' : 'РЕКОМЕНДАЦИЯ';
    const rules = category.rules.map((rule) => `- ${rule}`).join('\n');

    return `[${name}] ${priority}\n${category.description}\n${rules}`;
  }

  formatViolationMessage(violations: Array<{
    category: string;
    rule: string;
    explanation: string;
  }>): string {
    const messages = violations
      .map(
        (v) =>
          `\n[${v.category}] ${v.rule}\n→ ${v.explanation}`
      )
      .join('\n');

    return `❌ Ответ нарушает инварианты:${messages}\n\nПожалуйста, переформулируйте запрос с учетом ограничений.\nИспользуйте /invariants для просмотра всех правил.`;
  }
}
