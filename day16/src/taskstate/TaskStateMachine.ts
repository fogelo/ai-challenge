import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  TaskState,
  TaskContext,
  StateTransition,
  ALLOWED_TRANSITIONS,
  STATE_INDICATORS,
  STATE_INSTRUCTIONS,
} from './types.js';

export class TaskStateMachine {
  private currentTask: TaskContext | null = null;
  private stateDir: string;

  constructor(stateDir: string = '.task-state') {
    this.stateDir = stateDir;
    this.ensureDirectoryExists();
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }
  }

  private generateTaskId(): string {
    return crypto.randomBytes(6).toString('hex');
  }

  private getTaskFilePath(taskId: string): string {
    return path.join(this.stateDir, `${taskId}.json`);
  }

  /**
   * Create a new task in PLANNING state
   */
  createTask(description: string): TaskContext {
    const taskId = this.generateTaskId();
    const now = new Date().toISOString();

    const task: TaskContext = {
      taskId,
      description,
      currentState: TaskState.PLANNING,
      startedAt: now,
      updatedAt: now,
      stateHistory: [
        {
          from: 'START',
          to: TaskState.PLANNING,
          timestamp: now,
        },
      ],
    };

    this.currentTask = task;
    this.save();
    return task;
  }

  /**
   * Attempt to transition to a new state
   * Returns true if transition is allowed and successful
   */
  transition(nextState: TaskState, reason?: string): boolean {
    if (!this.currentTask) {
      throw new Error('No active task');
    }

    const currentState = this.currentTask.currentState;
    const allowedStates = ALLOWED_TRANSITIONS[currentState];

    if (!allowedStates.includes(nextState)) {
      return false;
    }

    const now = new Date().toISOString();
    const transition: StateTransition = {
      from: currentState,
      to: nextState,
      timestamp: now,
      reason,
    };

    this.currentTask.currentState = nextState;
    this.currentTask.updatedAt = now;
    this.currentTask.stateHistory.push(transition);

    this.save();
    return true;
  }

  /**
   * Save current task to disk
   */
  private save(): void {
    if (!this.currentTask) return;

    const filePath = this.getTaskFilePath(this.currentTask.taskId);
    fs.writeFileSync(filePath, JSON.stringify(this.currentTask, null, 2), 'utf-8');
  }

  /**
   * Load task from disk
   */
  load(taskId: string): boolean {
    const filePath = this.getTaskFilePath(taskId);

    if (!fs.existsSync(filePath)) {
      return false;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    this.currentTask = JSON.parse(content) as TaskContext;
    return true;
  }

  /**
   * Get current task context
   */
  getCurrentTask(): TaskContext | null {
    return this.currentTask;
  }

  /**
   * Get prompt injection for current state
   */
  getStatePrompt(): string {
    if (!this.currentTask) {
      return '';
    }

    const state = this.currentTask.currentState;
    const indicator = STATE_INDICATORS[state];
    const instruction = STATE_INSTRUCTIONS[state];
    const history = this.currentTask.stateHistory
      .map((t) => `${t.from} → ${t.to}`)
      .join(' → ');

    return `
=== ТЕКУЩЕЕ СОСТОЯНИЕ ЗАДАЧИ ===
Задача: ${this.currentTask.description}
Текущий этап: ${state.toUpperCase()} ${indicator}
Что делать: ${instruction}
История переходов: ${history}
===
`;
  }

  /**
   * List all task files
   */
  listTasks(): Array<{ taskId: string; description: string; state: TaskState; updatedAt: string }> {
    if (!fs.existsSync(this.stateDir)) {
      return [];
    }

    const files = fs.readdirSync(this.stateDir).filter((f) => f.endsWith('.json'));

    return files
      .map((fileName) => {
        try {
          const filePath = path.join(this.stateDir, fileName);
          const content = fs.readFileSync(filePath, 'utf-8');
          const task = JSON.parse(content) as TaskContext;

          return {
            taskId: task.taskId,
            description: task.description,
            state: task.currentState,
            updatedAt: task.updatedAt,
          };
        } catch {
          return null;
        }
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  /**
   * Update task stage content (plan, execution result, validation)
   */
  updateStageContent(stage: 'plan' | 'execution' | 'validation', content: string): void {
    if (!this.currentTask) return;

    switch (stage) {
      case 'plan':
        this.currentTask.planContent = content;
        break;
      case 'execution':
        this.currentTask.executionResult = content;
        break;
      case 'validation':
        this.currentTask.validationResult = content;
        break;
    }

    this.currentTask.updatedAt = new Date().toISOString();
    this.save();
  }

  /**
   * Clear current task (without deleting file)
   */
  clearCurrent(): void {
    this.currentTask = null;
  }
}
