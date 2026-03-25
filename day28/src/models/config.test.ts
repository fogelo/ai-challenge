import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from './config.js';
import fs from 'fs';
import path from 'path';

const TEST_CONFIG_PATH = path.join(process.cwd(), 'config.json');

describe('ConfigManager provider support', () => {
  let backup: string | null = null;

  beforeEach(() => {
    if (fs.existsSync(TEST_CONFIG_PATH)) {
      backup = fs.readFileSync(TEST_CONFIG_PATH, 'utf-8');
    }
  });

  afterEach(() => {
    if (backup !== null) {
      fs.writeFileSync(TEST_CONFIG_PATH, backup);
    } else if (fs.existsSync(TEST_CONFIG_PATH)) {
      fs.unlinkSync(TEST_CONFIG_PATH);
    }
  });

  it('getProviderConfig returns defaults when fields missing', () => {
    const minimal = {
      currentModel: 'anthropic/claude-3.5-sonnet',
      favoriteModels: ['anthropic/claude-3.5-sonnet'],
      summarization: { threshold: 0.7, keepRecentMessages: 10 },
      strategy: { default: 'sliding', slidingWindow: { size: 10 }, stickyFacts: { windowSize: 10 }, branching: {} },
    };
    fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(minimal));

    const cm = new ConfigManager();
    const cfg = cm.getProviderConfig();

    expect(cfg.provider).toBe('openrouter');
    expect(cfg.ollamaBaseUrl).toBe('http://localhost:11434');
    expect(cfg.ollamaModel).toBe('llama3.2');
  });

  it('setProvider persists provider and ollamaModel', () => {
    const cm = new ConfigManager();
    cm.setProvider('ollama', 'gemma3');

    const cm2 = new ConfigManager();
    const cfg = cm2.getProviderConfig();

    expect(cfg.provider).toBe('ollama');
    expect(cfg.ollamaModel).toBe('gemma3');
  });

  it('setProvider to openrouter preserves ollamaModel', () => {
    const cm = new ConfigManager();
    cm.setProvider('ollama', 'llama3.2');
    cm.setProvider('openrouter');

    const cfg = cm.getProviderConfig();
    expect(cfg.provider).toBe('openrouter');
    expect(cfg.ollamaModel).toBe('llama3.2');
  });
});
