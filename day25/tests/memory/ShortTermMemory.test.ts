import { ShortTermMemory } from '../../src/memory/ShortTermMemory.js';
import { Message } from '../../src/types/index.js';
import fs from 'fs/promises';
import path from 'path';

describe('ShortTermMemory', () => {
  const testDir = '.memory-test/short-term';
  let memory: ShortTermMemory;

  beforeEach(async () => {
    memory = new ShortTermMemory(testDir);
    await memory.initialize();
  });

  afterEach(async () => {
    await fs.rm('.memory-test', { recursive: true, force: true });
  });

  test('should add message to session', () => {
    const message: Message = { role: 'user', content: 'Test' };
    memory.addMessage(message);

    const messages = memory.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Test');
  });

  test('should save and load session', async () => {
    const message: Message = { role: 'user', content: 'Test' };
    memory.addMessage(message);
    await memory.save();

    const newMemory = new ShortTermMemory(testDir);
    await newMemory.load();

    expect(newMemory.getMessages()).toHaveLength(1);
  });

  test('should clear session', () => {
    memory.addMessage({ role: 'user', content: 'Test' });
    memory.clear();

    expect(memory.getMessages()).toHaveLength(0);
  });
});
