import { WorkingMemory } from '../../src/memory/WorkingMemory.js';
import { Task } from '../../src/memory/types.js';
import fs from 'fs/promises';

describe('WorkingMemory', () => {
  const testDir = '.memory-test/working';
  let memory: WorkingMemory;

  beforeEach(async () => {
    memory = new WorkingMemory(testDir);
    await memory.initialize();
  });

  afterEach(async () => {
    await fs.rm('.memory-test', { recursive: true, force: true });
  });

  test('should set and get active task', async () => {
    const task: Task = {
      taskId: 'task-1',
      description: 'Test task',
      status: 'in_progress',
      context: {},
      startedAt: new Date().toISOString(),
    };

    await memory.setTask(task);
    const retrieved = memory.getTask();

    expect(retrieved?.description).toBe('Test task');
  });

  test('should add context to task', async () => {
    const task: Task = {
      taskId: 'task-1',
      description: 'Test',
      status: 'in_progress',
      context: {},
      startedAt: new Date().toISOString(),
    };

    await memory.setTask(task);
    await memory.addContext('files', ['test.ts']);

    const retrieved = memory.getTask();
    expect(retrieved?.context.files).toEqual(['test.ts']);
  });

  test('should complete task', async () => {
    const task: Task = {
      taskId: 'task-1',
      description: 'Test',
      status: 'in_progress',
      context: {},
      startedAt: new Date().toISOString(),
    };

    await memory.setTask(task);
    await memory.completeTask();

    expect(memory.getTask()).toBeNull();
  });
});
