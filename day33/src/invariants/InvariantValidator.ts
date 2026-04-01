// src/invariants/InvariantValidator.ts

import { sendMessage } from '../api/openrouter.js';
import { InvariantSet, ValidationResult } from './types.js';
import { InvariantInjector } from './InvariantInjector.js';

export class InvariantValidator {
  private injector: InvariantInjector;

  constructor() {
    this.injector = new InvariantInjector();
  }

  async validate(
    agentResponse: string,
    invariants: InvariantSet,
    validatorModel: string
  ): Promise<ValidationResult> {
    try {
      const formattedInvariants = this.injector.formatForPrompt(invariants);

      if (!formattedInvariants) {
        // Нет инвариантов - всегда valid
        return { valid: true, violations: [] };
      }

      const validatorPrompt = this.buildValidatorPrompt(
        formattedInvariants,
        agentResponse
      );

      const response = await sendMessage(
        [{ role: 'user', content: validatorPrompt }],
        validatorModel,
        undefined,
        0 // temperature = 0 для детерминированности
      );

      // Парсим JSON ответ
      const result = this.parseValidationResponse(response.content);
      return result;
    } catch (error) {
      console.warn(
        `Предупреждение: валидация инвариантов недоступна: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      // В случае ошибки пропускаем валидацию
      return { valid: true, violations: [] };
    }
  }

  private buildValidatorPrompt(
    formattedInvariants: string,
    agentResponse: string
  ): string {
    return `Ты валидатор инвариантов. Проверь, нарушает ли ответ агента какие-либо правила.

${formattedInvariants}

ОТВЕТ АГЕНТА:
${agentResponse}

Верни JSON в формате:
{
  "valid": boolean,
  "violations": [
    {
      "category": "название_категории",
      "rule": "конкретное нарушенное правило",
      "explanation": "почему это нарушение"
    }
  ]
}

Если нарушений нет, верни {"valid": true, "violations": []}.
Ответь ТОЛЬКО JSON, без дополнительного текста.`;
  }

  private parseValidationResponse(response: string): ValidationResult {
    try {
      // Пытаемся извлечь JSON из ответа
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('JSON не найден в ответе');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (typeof parsed.valid !== 'boolean') {
        throw new Error('Поле valid должно быть boolean');
      }

      if (!Array.isArray(parsed.violations)) {
        throw new Error('Поле violations должно быть массивом');
      }

      return parsed as ValidationResult;
    } catch (error) {
      throw new Error(
        `Ошибка парсинга ответа валидатора: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
