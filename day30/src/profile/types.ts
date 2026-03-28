export interface UserProfile {
  name: string;

  // Style
  responseStyle: 'краткий' | 'подробный';
  tone: 'формальный' | 'разговорный';
  includeCodeExamples: boolean;
  detailLevel: 'минимальный' | 'средний' | 'максимальный';

  // Context
  context: {
    purpose: string;
    domain: string;
    goals: string[];
  };

  // Technical preferences
  stack: string[];
  preferredLanguage: string;

  // Constraints
  constraints: {
    forbidden: string[];
    required: string[];
    rules: string[];
  };
}

export interface ProfileMetadata {
  name: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface InterviewQuestion {
  id: string;
  question: string;
  type: 'choice' | 'text' | 'multitext' | 'skip';
  options?: string[];
  defaultValue?: string;
  canSkip?: boolean;
}

export interface InterviewAnswers {
  profileName: string;
  purpose: string;
  responseStyle: 'краткий' | 'подробный';
  tone: 'формальный' | 'разговорный';
  includeCodeExamples: boolean;
  stack: string[];
  preferredLanguage: string;
  detailLevel: 'минимальный' | 'средний' | 'максимальный';
}
