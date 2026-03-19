import { MemoryContext, Task, Profile, Constraints, Fact } from '../../src/memory/types.js';

describe('Memory Types', () => {
  test('should create valid MemoryContext', () => {
    const context: MemoryContext = {
      shortTerm: [],
      working: null,
      longTerm: {
        profile: {
          style: { responseLength: 'detailed', tone: 'professional', language: 'russian' },
          preferences: { stack: ['TypeScript'], frameworks: [] }
        },
        constraints: { forbidden: [], required: [], rules: [] },
        knowledge: []
      }
    };

    expect(context.longTerm.profile.style.language).toBe('russian');
  });
});
