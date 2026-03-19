/**
 * Task state enum - represents the current stage of task execution
 */
export enum TaskState {
  PLANNING = 'planning',
  EXECUTION = 'execution',
  VALIDATION = 'validation',
  DONE = 'done',
}

/**
 * State transition record
 */
export interface StateTransition {
  from: TaskState | 'START';
  to: TaskState;
  timestamp: string;
  reason?: string;
}

/**
 * Task context - complete state of a task
 */
export interface TaskContext {
  taskId: string;
  description: string;
  currentState: TaskState;
  startedAt: string;
  updatedAt: string;
  stateHistory: StateTransition[];
  planContent?: string;
  executionResult?: string;
  validationResult?: string;
}

/**
 * Allowed state transitions map
 */
export const ALLOWED_TRANSITIONS: Record<TaskState, TaskState[]> = {
  [TaskState.PLANNING]: [TaskState.EXECUTION],
  [TaskState.EXECUTION]: [TaskState.VALIDATION, TaskState.PLANNING],
  [TaskState.VALIDATION]: [TaskState.DONE, TaskState.EXECUTION],
  [TaskState.DONE]: [],
};

/**
 * State emoji indicators for UI
 */
export const STATE_INDICATORS: Record<TaskState, string> = {
  [TaskState.PLANNING]: '🟡',
  [TaskState.EXECUTION]: '🔵',
  [TaskState.VALIDATION]: '🟠',
  [TaskState.DONE]: '🟢',
};

/**
 * State instructions for prompt injection
 */
export const STATE_INSTRUCTIONS: Record<TaskState, string> = {
  [TaskState.PLANNING]: 'Задавай уточняющие вопросы пользователю, составь детальный план. НЕ начинай выполнение до утверждения плана.',
  [TaskState.EXECUTION]: 'Реализуй утвержденный план. Придерживайся плана, не делай лишних изменений. Сообщи о завершении.',
  [TaskState.VALIDATION]: 'Проверь результат выполнения. Предложи тесты, найди проблемы, рекомендуй улучшения.',
  [TaskState.DONE]: 'Задача завершена. Подведи итоги и покажи финальный результат.',
};
