import { ModelConfig } from '../types/index.js';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

const DEFAULT_CONFIG: ModelConfig = {
  currentModel: 'anthropic/claude-3.5-sonnet',
  favoriteModels: [
    'google/gemini-flash-1.5',
    'meta-llama/llama-3.1-8b-instruct',
    'anthropic/claude-3-haiku',
    'openai/gpt-4o-mini',
    'anthropic/claude-3.5-sonnet',
    'openai/gpt-4o',
  ],
};

export class ConfigManager {
  private config: ModelConfig;

  constructor() {
    this.config = this.load();
  }

  load(): ModelConfig {
    try {
      if (!fs.existsSync(CONFIG_PATH)) {
        this.save(DEFAULT_CONFIG);
        return DEFAULT_CONFIG;
      }

      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(data);

      // Validate structure
      if (!parsed.currentModel || !Array.isArray(parsed.favoriteModels)) {
        throw new Error('Invalid config structure');
      }

      return parsed;
    } catch (error) {
      console.error('Failed to load config, using default:', error);

      // Backup corrupted config
      if (fs.existsSync(CONFIG_PATH)) {
        fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.backup`);
      }

      this.save(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
  }

  save(config: ModelConfig): void {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
      this.config = config;
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  getConfig(): ModelConfig {
    return this.config;
  }

  setCurrentModel(modelId: string): void {
    this.config.currentModel = modelId;
    this.save(this.config);
  }

  addFavoriteModel(modelId: string): boolean {
    if (this.config.favoriteModels.includes(modelId)) {
      return false; // Already exists
    }

    this.config.favoriteModels.push(modelId);
    this.save(this.config);
    return true;
  }

  removeFavoriteModel(index: number): boolean {
    if (index < 0 || index >= this.config.favoriteModels.length) {
      return false; // Invalid index
    }

    if (this.config.favoriteModels.length <= 1) {
      return false; // Can't remove last model
    }

    this.config.favoriteModels.splice(index, 1);

    // If current model was removed, switch to first available
    if (!this.config.favoriteModels.includes(this.config.currentModel)) {
      this.config.currentModel = this.config.favoriteModels[0];
    }

    this.save(this.config);
    return true;
  }
}
