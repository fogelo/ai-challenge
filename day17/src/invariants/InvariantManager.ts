// src/invariants/InvariantManager.ts

import { InvariantStorage } from './InvariantStorage.js';
import { InvariantValidator } from './InvariantValidator.js';
import { InvariantInjector } from './InvariantInjector.js';
import { InvariantSet, ValidationResult, Violation } from './types.js';

export class InvariantManager {
  private storage: InvariantStorage;
  private validator: InvariantValidator;
  private injector: InvariantInjector;
  private invariants: InvariantSet | null = null;

  constructor(invariantsDir: string = '.invariants') {
    this.storage = new InvariantStorage(invariantsDir);
    this.validator = new InvariantValidator();
    this.injector = new InvariantInjector();
  }

  async load(): Promise<void> {
    this.invariants = await this.storage.load();
  }

  async reload(): Promise<void> {
    await this.load();
  }

  async save(invariants: InvariantSet): Promise<void> {
    await this.storage.save(invariants);
    this.invariants = invariants;
  }

  getFormattedInvariants(): string | null {
    if (!this.invariants) {
      return null;
    }
    return this.injector.formatForPrompt(this.invariants);
  }

  async validate(
    agentResponse: string,
    validatorModel: string
  ): Promise<ValidationResult> {
    if (!this.invariants) {
      return { valid: true, violations: [] };
    }

    return await this.validator.validate(
      agentResponse,
      this.invariants,
      validatorModel
    );
  }

  formatViolationMessage(validation: ValidationResult): string {
    return this.injector.formatViolationMessage(validation.violations);
  }

  getInvariants(): InvariantSet | null {
    return this.invariants;
  }

  async addRule(
    category: string,
    rule: string,
    type: 'hard' | 'soft' = 'hard'
  ): Promise<void> {
    if (!this.invariants) {
      await this.load();
    }

    if (!this.invariants) {
      throw new Error('Не удалось загрузить инварианты');
    }

    if (!this.invariants.invariants[category]) {
      throw new Error(`Категория ${category} не найдена`);
    }

    this.invariants.invariants[category].rules.push(rule);
    await this.save(this.invariants);
  }

  async removeRule(category: string, ruleIndex: number): Promise<void> {
    if (!this.invariants) {
      await this.load();
    }

    if (!this.invariants) {
      throw new Error('Не удалось загрузить инварианты');
    }

    if (!this.invariants.invariants[category]) {
      throw new Error(`Категория ${category} не найдена`);
    }

    const rules = this.invariants.invariants[category].rules;
    if (ruleIndex < 0 || ruleIndex >= rules.length) {
      throw new Error(`Индекс ${ruleIndex} вне диапазона`);
    }

    rules.splice(ruleIndex, 1);
    await this.save(this.invariants);
  }
}
