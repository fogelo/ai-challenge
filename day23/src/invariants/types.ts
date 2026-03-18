// src/invariants/types.ts

export type InvariantType = 'hard' | 'soft';

export interface InvariantCategory {
  type: InvariantType;
  description: string;
  rules: string[];
}

export interface InvariantSet {
  version: string;
  invariants: Record<string, InvariantCategory>;
}

export interface Violation {
  category: string;
  rule: string;
  explanation: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
}
