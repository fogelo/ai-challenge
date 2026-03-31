import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { Message } from '../../src/types/index.js';
import fs from 'fs/promises';

describe('MemoryManager', () => {
  let manager: MemoryManager;

  beforeEach(async () => {
    manager = new MemoryManager('.memory-test');
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.rm('.memory-test', { recursive: true, force: true });
  });

  test('should provide access to all memory layers', () => {
    expect(manager.getShortTerm()).toBeDefined();
    expect(manager.getWorking()).toBeDefined();
    expect(manager.getLongTerm()).toBeDefined();
  });

  test('should build context for prompt', () => {
    manager.getShortTerm().addMessage({ role: 'user', content: 'Test' });

    const context = manager.getContextForPrompt();

    expect(context.shortTerm).toHaveLength(1);
    expect(context.working).toBeNull();
    expect(context.longTerm.profile).toBeDefined();
  });

  test('should clear specific layer', async () => {
    manager.getShortTerm().addMessage({ role: 'user', content: 'Test' });
    await manager.clear('short');

    const context = manager.getContextForPrompt();
    expect(context.shortTerm).toHaveLength(0);
  });
});
