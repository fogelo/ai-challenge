import { ShortTermMemory } from './ShortTermMemory.js';
import { WorkingMemory } from './WorkingMemory.js';
import { LongTermMemory } from './LongTermMemory.js';
import { MemoryContext, MemoryLayer } from './types.js';

export class MemoryManager {
  private shortTerm: ShortTermMemory;
  private working: WorkingMemory;
  private longTerm: LongTermMemory;

  constructor(baseDir: string = '.memory') {
    this.shortTerm = new ShortTermMemory(`${baseDir}/short-term`);
    this.working = new WorkingMemory(`${baseDir}/working`);
    this.longTerm = new LongTermMemory(`${baseDir}/long-term`);
  }

  async initialize(): Promise<void> {
    await this.shortTerm.initialize();
    await this.working.initialize();
    await this.longTerm.initialize();
  }

  getContextForPrompt(): MemoryContext {
    return {
      shortTerm: this.shortTerm.getMessages(),
      working: this.working.getTask(),
      longTerm: {
        profile: this.longTerm.getProfile(),
        constraints: this.longTerm.getConstraints(),
        knowledge: this.longTerm.getKnowledge().facts,
      },
    };
  }

  getShortTerm(): ShortTermMemory {
    return this.shortTerm;
  }

  getWorking(): WorkingMemory {
    return this.working;
  }

  getLongTerm(): LongTermMemory {
    return this.longTerm;
  }

  async clear(layer?: MemoryLayer): Promise<void> {
    if (!layer || layer === 'short') {
      this.shortTerm.clear();
      await this.shortTerm.save();
    }

    if (!layer || layer === 'working') {
      await this.working.clear();
    }

    if (!layer || layer === 'long') {
      // Don't clear long-term automatically - too destructive
      // User must manually edit files
    }
  }
}
