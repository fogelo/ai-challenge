import fs from 'fs/promises';
import path from 'path';
import { Task } from './types.js';

export class WorkingMemory {
  private taskFile: string;
  private task: Task | null = null;

  constructor(baseDir: string = '.memory/working') {
    this.taskFile = path.join(baseDir, 'active-task.json');
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.taskFile);
    await fs.mkdir(dir, { recursive: true });
    await this.load();
  }

  async setTask(task: Task): Promise<void> {
    this.task = task;
    await this.save();
  }

  getTask(): Task | null {
    return this.task ? { ...this.task } : null;
  }

  async addContext(key: string, value: any): Promise<void> {
    if (!this.task) {
      throw new Error('No active task');
    }

    this.task.context[key] = value;
    await this.save();
  }

  async completeTask(): Promise<void> {
    if (!this.task) {
      return;
    }

    this.task.status = 'completed';
    await this.save();

    // Archive and clear
    this.task = null;
    await this.save();
  }

  async clear(): Promise<void> {
    this.task = null;
    await this.save();
  }

  private async save(): Promise<void> {
    const data = this.task ? JSON.stringify(this.task, null, 2) : JSON.stringify(null);
    await fs.writeFile(this.taskFile, data, 'utf-8');
  }

  private async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.taskFile, 'utf-8');
      const parsed = JSON.parse(data);
      this.task = parsed === null ? null : parsed;
    } catch (error) {
      // File doesn't exist, keep null
    }
  }
}
