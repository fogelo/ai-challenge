import { ShortTermMemory } from './ShortTermMemory.js';
import { WorkingMemory } from './WorkingMemory.js';
import { LongTermMemory } from './LongTermMemory.js';
import { MemoryContext, MemoryLayer } from './types.js';
import { ProfileManager } from '../profile/index.js';

export class MemoryManager {
  private shortTerm: ShortTermMemory;
  private working: WorkingMemory;
  private longTerm: LongTermMemory;
  private profileManager: ProfileManager;

  constructor(baseDir: string = '.memory') {
    this.shortTerm = new ShortTermMemory(`${baseDir}/short-term`);
    this.working = new WorkingMemory(`${baseDir}/working`);
    this.longTerm = new LongTermMemory(`${baseDir}/long-term`);
    this.profileManager = new ProfileManager(`${baseDir}/profiles`);
  }

  async initialize(): Promise<void> {
    await this.shortTerm.initialize();
    await this.working.initialize();
    await this.longTerm.initialize();
    await this.profileManager.initialize();

    // Load active profile into LongTermMemory
    const activeProfile = this.profileManager.getActiveProfile();
    if (activeProfile) {
      this.syncProfileToLongTerm(activeProfile);
    }
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

  getProfileManager(): ProfileManager {
    return this.profileManager;
  }

  private syncProfileToLongTerm(profile: any): void {
    // Update LongTerm profile
    this.longTerm['profile'] = {
      style: {
        responseLength: profile.responseStyle,
        tone: profile.tone,
        language: 'russian',
      },
      preferences: {
        stack: profile.stack,
        frameworks: [],
      },
    };

    // Update LongTerm constraints
    this.longTerm['constraints'] = profile.constraints;
  }

  async switchProfile(name: string): Promise<boolean> {
    const success = await this.profileManager.switchProfile(name);

    if (success) {
      const profile = this.profileManager.getActiveProfile();
      if (profile) {
        this.syncProfileToLongTerm(profile);
      }
    }

    return success;
  }
}
