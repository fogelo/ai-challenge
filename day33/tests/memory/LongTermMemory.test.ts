import { LongTermMemory } from '../../src/memory/LongTermMemory.js';
import { Fact } from '../../src/memory/types.js';
import fs from 'fs/promises';

describe('LongTermMemory', () => {
  const testDir = '.memory-test/long-term';
  let memory: LongTermMemory;

  beforeEach(async () => {
    memory = new LongTermMemory(testDir);
    await memory.initialize();
  });

  afterEach(async () => {
    await fs.rm('.memory-test', { recursive: true, force: true });
  });

  test('should update profile', async () => {
    await memory.updateProfile('style.tone', 'professional');
    const profile = memory.getProfile();

    expect(profile.style.tone).toBe('professional');
  });

  test('should add and remove constraints', async () => {
    await memory.addConstraint('forbidden', 'Python');
    await memory.addConstraint('required', 'TypeScript');

    let constraints = memory.getConstraints();
    expect(constraints.forbidden).toContain('Python');
    expect(constraints.required).toContain('TypeScript');

    await memory.removeConstraint('forbidden', 'Python');
    constraints = memory.getConstraints();
    expect(constraints.forbidden).not.toContain('Python');
  });

  test('should add knowledge fact', async () => {
    const fact: Fact = {
      id: 'fact-1',
      content: 'Test fact',
      addedAt: new Date().toISOString(),
      relevance: 'high',
    };

    await memory.addKnowledge(fact);
    const knowledge = memory.getKnowledge();

    expect(knowledge.facts).toHaveLength(1);
    expect(knowledge.facts[0].content).toBe('Test fact');
  });
});
