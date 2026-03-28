import fs from 'fs/promises';
import path from 'path';
import { UserProfile, ProfileMetadata } from './types.js';

export class ProfileManager {
  private profilesDir: string;
  private activeFile: string;
  private activeProfile: UserProfile | null = null;

  constructor(baseDir: string = '.memory/profiles') {
    this.profilesDir = baseDir;
    this.activeFile = path.join(baseDir, '.active');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.profilesDir, { recursive: true });

    // Load active profile if exists
    if (await this.hasProfiles()) {
      const activeName = await this.loadActiveName();
      if (activeName) {
        this.activeProfile = await this.loadProfile(activeName);
      }
    }
  }

  async hasProfiles(): Promise<boolean> {
    try {
      const files = await fs.readdir(this.profilesDir);
      return files.some(f => f.endsWith('.json') && f !== '.active');
    } catch {
      return false;
    }
  }

  private async loadActiveName(): Promise<string | null> {
    try {
      const content = await fs.readFile(this.activeFile, 'utf-8');
      return content.trim();
    } catch {
      return null;
    }
  }

  private async saveActiveName(name: string): Promise<void> {
    await fs.writeFile(this.activeFile, name, 'utf-8');
  }

  private getProfilePath(name: string): string {
    return path.join(this.profilesDir, `${name}.json`);
  }

  async loadProfile(name: string): Promise<UserProfile | null> {
    try {
      const data = await fs.readFile(this.getProfilePath(name), 'utf-8');
      const profile = JSON.parse(data);
      this.validateProfile(profile);
      return profile;
    } catch {
      return null;
    }
  }

  private validateProfile(profile: any): profile is UserProfile {
    const required = ['name', 'responseStyle', 'tone', 'includeCodeExamples', 'context'];

    for (const field of required) {
      if (!(field in profile)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (!['краткий', 'подробный'].includes(profile.responseStyle)) {
      throw new Error('Invalid responseStyle');
    }

    if (!['формальный', 'разговорный'].includes(profile.tone)) {
      throw new Error('Invalid tone');
    }

    return true;
  }

  async createProfile(profile: UserProfile): Promise<void> {
    await fs.writeFile(
      this.getProfilePath(profile.name),
      JSON.stringify(profile, null, 2),
      'utf-8'
    );

    // Set as active if it's the first profile
    if (!await this.loadActiveName()) {
      await this.saveActiveName(profile.name);
      this.activeProfile = profile;
    }
  }

  async listProfiles(): Promise<ProfileMetadata[]> {
    try {
      const files = await fs.readdir(this.profilesDir);
      const profiles: ProfileMetadata[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const name = file.replace('.json', '');
          const profilePath = this.getProfilePath(name);
          const stats = await fs.stat(profilePath);

          profiles.push({
            name,
            createdAt: stats.birthtime.toISOString(),
            lastUsedAt: stats.mtime.toISOString(),
          });
        }
      }

      return profiles;
    } catch {
      return [];
    }
  }

  getActiveProfile(): UserProfile | null {
    return this.activeProfile;
  }

  async switchProfile(name: string): Promise<boolean> {
    const profile = await this.loadProfile(name);

    if (!profile) {
      return false;
    }

    await this.saveActiveName(name);
    this.activeProfile = profile;

    // Update lastUsedAt
    await fs.utimes(this.getProfilePath(name), new Date(), new Date());

    return true;
  }

  async deleteProfile(name: string): Promise<boolean> {
    // Don't delete active profile
    const activeName = await this.loadActiveName();
    if (name === activeName) {
      return false;
    }

    // Don't delete last profile
    const profiles = await this.listProfiles();
    if (profiles.length <= 1) {
      return false;
    }

    try {
      await fs.unlink(this.getProfilePath(name));
      return true;
    } catch {
      return false;
    }
  }

  async updateProfile(name: string, updates: Partial<UserProfile>): Promise<boolean> {
    const profile = await this.loadProfile(name);

    if (!profile) {
      return false;
    }

    const updated = { ...profile, ...updates };
    await this.createProfile(updated);

    // Update active profile if it's the current one
    if (this.activeProfile?.name === name) {
      this.activeProfile = updated;
    }

    return true;
  }

  createDefaultProfile(): UserProfile {
    return {
      name: 'default',
      responseStyle: 'подробный',
      tone: 'разговорный',
      includeCodeExamples: true,
      detailLevel: 'средний',
      context: {
        purpose: 'общее использование',
        domain: 'программирование',
        goals: [],
      },
      stack: [],
      preferredLanguage: 'typescript',
      constraints: {
        forbidden: [],
        required: [],
        rules: [],
      },
    };
  }
}
