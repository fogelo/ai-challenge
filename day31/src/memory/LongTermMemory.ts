import fs from 'fs/promises';
import path from 'path';
import { Profile, Constraints, Knowledge, Fact } from './types.js';

export class LongTermMemory {
  private profileFile: string;
  private constraintsFile: string;
  private knowledgeFile: string;

  private profile: Profile;
  private constraints: Constraints;
  private knowledge: Knowledge;

  constructor(baseDir: string = '.memory/long-term') {
    this.profileFile = path.join(baseDir, 'profile.json');
    this.constraintsFile = path.join(baseDir, 'constraints.json');
    this.knowledgeFile = path.join(baseDir, 'knowledge.json');

    // Defaults
    this.profile = {
      style: { responseLength: 'detailed', tone: 'professional', language: 'russian' },
      preferences: { stack: [], frameworks: [] },
    };
    this.constraints = { forbidden: [], required: [], rules: [] };
    this.knowledge = { facts: [], decisions: [] };
  }

  async initialize(): Promise<void> {
    const dir = path.dirname(this.profileFile);
    await fs.mkdir(dir, { recursive: true });
    await this.load();
  }

  getProfile(): Profile {
    return { ...this.profile };
  }

  async updateProfile(key: string, value: any): Promise<void> {
    const keys = key.split('.');
    let obj: any = this.profile;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in obj)) {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }

    const lastKey = keys[keys.length - 1];

    // Handle arrays
    if (typeof value === 'string' && value.includes(',')) {
      obj[lastKey] = value.split(',').map(s => s.trim());
    } else {
      obj[lastKey] = value;
    }

    await this.saveProfile();
  }

  getConstraints(): Constraints {
    return { ...this.constraints };
  }

  async addConstraint(type: 'forbidden' | 'required' | 'rules', value: string): Promise<void> {
    if (!this.constraints[type].includes(value)) {
      this.constraints[type].push(value);
      await this.saveConstraints();
    }
  }

  async removeConstraint(type: 'forbidden' | 'required' | 'rules', value: string): Promise<void> {
    this.constraints[type] = this.constraints[type].filter(v => v !== value);
    await this.saveConstraints();
  }

  async addKnowledge(fact: Fact): Promise<void> {
    this.knowledge.facts.push(fact);
    await this.saveKnowledge();
  }

  getKnowledge(): Knowledge {
    return { ...this.knowledge };
  }

  async load(): Promise<void> {
    await this.loadProfile();
    await this.loadConstraints();
    await this.loadKnowledge();
  }

  async save(): Promise<void> {
    await this.saveProfile();
    await this.saveConstraints();
    await this.saveKnowledge();
  }

  private async loadProfile(): Promise<void> {
    try {
      const data = await fs.readFile(this.profileFile, 'utf-8');
      this.profile = JSON.parse(data);
    } catch (error) {
      // Use defaults
    }
  }

  private async saveProfile(): Promise<void> {
    await fs.writeFile(this.profileFile, JSON.stringify(this.profile, null, 2), 'utf-8');
  }

  private async loadConstraints(): Promise<void> {
    try {
      const data = await fs.readFile(this.constraintsFile, 'utf-8');
      this.constraints = JSON.parse(data);
    } catch (error) {
      // Use defaults
    }
  }

  private async saveConstraints(): Promise<void> {
    await fs.writeFile(this.constraintsFile, JSON.stringify(this.constraints, null, 2), 'utf-8');
  }

  private async loadKnowledge(): Promise<void> {
    try {
      const data = await fs.readFile(this.knowledgeFile, 'utf-8');
      this.knowledge = JSON.parse(data);
    } catch (error) {
      // Use defaults
    }
  }

  private async saveKnowledge(): Promise<void> {
    await fs.writeFile(this.knowledgeFile, JSON.stringify(this.knowledge, null, 2), 'utf-8');
  }
}
