// src/invariants/InvariantStorage.ts

import fs from 'fs/promises';
import path from 'path';
import { InvariantSet } from './types.js';

export class InvariantStorage {
  private invariantsDir: string;
  private defaultFile: string;

  constructor(invariantsDir: string = '.invariants') {
    this.invariantsDir = invariantsDir;
    this.defaultFile = path.join(invariantsDir, 'default.json');
  }

  async load(): Promise<InvariantSet> {
    try {
      // Проверяем существование директории
      await fs.mkdir(this.invariantsDir, { recursive: true });

      // Проверяем существование файла
      try {
        await fs.access(this.defaultFile);
      } catch {
        // Файл не существует, создаем дефолтный
        await this.createDefaultFile();
      }

      // Читаем файл
      const content = await fs.readFile(this.defaultFile, 'utf-8');
      const data = JSON.parse(content);

      // Валидация структуры
      this.validateSchema(data);

      return data;
    } catch (error) {
      throw new Error(
        `Ошибка загрузки инвариантов: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async save(invariants: InvariantSet): Promise<void> {
    try {
      await fs.mkdir(this.invariantsDir, { recursive: true });
      const content = JSON.stringify(invariants, null, 2);
      await fs.writeFile(this.defaultFile, content, 'utf-8');
    } catch (error) {
      throw new Error(
        `Ошибка сохранения инвариантов: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async createDefaultFile(): Promise<void> {
    const defaultInvariants: InvariantSet = {
      version: '1.0',
      invariants: {
        stack: {
          type: 'hard',
          description: 'Технологический стек проекта',
          rules: [
            'Только TypeScript (никакого JavaScript)',
            'React 18+ с хуками',
            'Vite как инструмент сборки',
          ],
        },
        architecture: {
          type: 'hard',
          description: 'Архитектурные паттерны',
          rules: [
            'MVI архитектура (Model-View-Intent)',
            'Компонентный дизайн',
            'Только функциональные компоненты',
          ],
        },
        bans: {
          type: 'hard',
          description: 'Запрещенные технологии и паттерны',
          rules: [
            'Никаких классовых компонентов',
            'Никакого jQuery или прямой работы с DOM',
            'Никаких inline стилей (использовать CSS modules или styled-components)',
          ],
        },
        bestPractices: {
          type: 'soft',
          description: 'Рекомендуемые практики',
          rules: [
            'Предпочитать именованные экспорты',
            'Использовать TypeScript strict mode',
            'Добавлять JSDoc комментарии для сложной логики',
          ],
        },
      },
    };

    await this.save(defaultInvariants);
  }

  private validateSchema(data: any): void {
    if (!data || typeof data !== 'object') {
      throw new Error('Инварианты должны быть объектом');
    }

    if (!data.version || typeof data.version !== 'string') {
      throw new Error('Отсутствует поле version');
    }

    if (!data.invariants || typeof data.invariants !== 'object') {
      throw new Error('Отсутствует поле invariants');
    }

    // Проверяем структуру каждой категории
    for (const [category, value] of Object.entries(data.invariants)) {
      if (!value || typeof value !== 'object') {
        throw new Error(`Категория ${category} должна быть объектом`);
      }

      const cat = value as any;

      if (!cat.type || (cat.type !== 'hard' && cat.type !== 'soft')) {
        throw new Error(`Категория ${category}: type должен быть 'hard' или 'soft'`);
      }

      if (!cat.description || typeof cat.description !== 'string') {
        throw new Error(`Категория ${category}: отсутствует description`);
      }

      if (!Array.isArray(cat.rules)) {
        throw new Error(`Категория ${category}: rules должен быть массивом`);
      }
    }
  }
}
