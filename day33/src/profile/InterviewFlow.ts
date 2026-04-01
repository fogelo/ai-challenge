import { UserProfile, InterviewQuestion, InterviewAnswers } from './types.js';

export class InterviewFlow {
  private questions: InterviewQuestion[] = [
    {
      id: 'profileName',
      question: 'Как назовем этот профиль?',
      type: 'text',
      defaultValue: 'default',
      canSkip: false,
    },
    {
      id: 'purpose',
      question: 'Для чего вы будете использовать агента?',
      type: 'choice',
      options: [
        '1. Разработка проектов',
        '2. Изучение технологий',
        '3. Помощь в обучении',
        '4. Консультации по архитектуре',
        '5. Другое',
      ],
      canSkip: false,
    },
    {
      id: 'responseStyle',
      question: 'Предпочитаемый стиль ответов?',
      type: 'choice',
      options: ['1. Краткий', '2. Подробный'],
      canSkip: false,
    },
    {
      id: 'tone',
      question: 'Тон общения?',
      type: 'choice',
      options: ['1. Формальный', '2. Разговорный'],
      canSkip: false,
    },
    {
      id: 'includeCodeExamples',
      question: 'Включать примеры кода в ответы?',
      type: 'choice',
      options: ['1. Да', '2. Нет'],
      canSkip: false,
    },
    {
      id: 'stack',
      question: 'Основной стек технологий? (через запятую, или пропустить)',
      type: 'multitext',
      canSkip: true,
    },
    {
      id: 'preferredLanguage',
      question: 'Предпочитаемый язык программирования? (или пропустить)',
      type: 'text',
      defaultValue: 'typescript',
      canSkip: true,
    },
    {
      id: 'detailLevel',
      question: 'Уровень детализации ответов?',
      type: 'choice',
      options: ['1. Минимальный', '2. Средний', '3. Максимальный'],
      canSkip: false,
    },
  ];

  getQuestions(): InterviewQuestion[] {
    return this.questions;
  }

  parseAnswer(question: InterviewQuestion, answer: string): any {
    if (answer.toLowerCase() === 'skip' && question.canSkip) {
      return question.defaultValue || '';
    }

    switch (question.type) {
      case 'choice': {
        const match = answer.match(/^(\d+)/);
        if (match && question.options) {
          const index = parseInt(match[1]) - 1;
          if (index >= 0 && index < question.options.length) {
            return question.options[index].replace(/^\d+\.\s*/, '');
          }
        }
        return answer;
      }
      case 'multitext': {
        return answer.split(',').map(s => s.trim()).filter(Boolean);
      }
      case 'text':
      default:
        return answer.trim();
    }
  }

  buildProfile(answers: Record<string, any>): UserProfile {
    const purposeMap: Record<string, string> = {
      'Разработка проектов': 'разработка проектов',
      'Изучение технологий': 'изучение технологий',
      'Помощь в обучении': 'помощь в обучении',
      'Консультации по архитектуре': 'консультации по архитектуре',
      'Другое': answers['purposeCustom'] || 'общее использование',
    };

    const purpose = purposeMap[answers['purpose']] || answers['purpose'] || 'общее использование';

    return {
      name: answers['profileName'] || 'default',
      responseStyle: answers['responseStyle'] === 'Краткий' ? 'краткий' : 'подробный',
      tone: answers['tone'] === 'Формальный' ? 'формальный' : 'разговорный',
      includeCodeExamples: answers['includeCodeExamples'] === 'Да',
      detailLevel: this.mapDetailLevel(answers['detailLevel']),
      context: {
        purpose,
        domain: this.inferDomain(purpose),
        goals: [],
      },
      stack: Array.isArray(answers['stack']) ? answers['stack'] : [],
      preferredLanguage: answers['preferredLanguage'] || 'typescript',
      constraints: {
        forbidden: [],
        required: [],
        rules: [],
      },
    };
  }

  private mapDetailLevel(answer: string): 'минимальный' | 'средний' | 'максимальный' {
    if (answer?.includes('Минимальный')) return 'минимальный';
    if (answer?.includes('Максимальный')) return 'максимальный';
    return 'средний';
  }

  private inferDomain(purpose: string): string {
    if (purpose.includes('разработка') || purpose.includes('проект')) {
      return 'программирование';
    }
    if (purpose.includes('обучение') || purpose.includes('изучение')) {
      return 'обучение';
    }
    if (purpose.includes('архитектура')) {
      return 'архитектура';
    }
    return 'общее';
  }

  validateAnswers(answers: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!answers['profileName'] || answers['profileName'].trim() === '') {
      errors.push('Имя профиля обязательно');
    }

    const required = ['purpose', 'responseStyle', 'tone', 'includeCodeExamples', 'detailLevel'];
    for (const field of required) {
      if (!answers[field]) {
        errors.push(`Поле ${field} обязательно`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
