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

describe('ConfigManager ollamaParams', () => {
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

  it('getOllamaParams returns defaults when field missing from config', () => {
    const minimal = {
      currentModel: 'anthropic/claude-3.5-sonnet',
      favoriteModels: ['anthropic/claude-3.5-sonnet'],
      summarization: { threshold: 0.7, keepRecentMessages: 10 },
      strategy: { default: 'sliding', slidingWindow: { size: 10 }, stickyFacts: { windowSize: 10 }, branching: {} },
    };
    fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(minimal));

    const cm = new ConfigManager();
    const params = cm.getOllamaParams();

    expect(params.maxTokens).toBe(2048);
    expect(params.numCtx).toBe(4096);
  });

  it('setOllamaParams persists and can be read back', () => {
    const cm = new ConfigManager();
    cm.setOllamaParams({ maxTokens: 1024, numCtx: 8192 });

    const cm2 = new ConfigManager();
    const params = cm2.getOllamaParams();

    expect(params.maxTokens).toBe(1024);
    expect(params.numCtx).toBe(8192);
  });

  it('setOllamaParams partial update preserves other fields', () => {
    const cm = new ConfigManager();
    cm.setOllamaParams({ maxTokens: 512, numCtx: 4096 });
    cm.setOllamaParams({ numCtx: 16384 });

    const params = cm.getOllamaParams();
    expect(params.maxTokens).toBe(512);
    expect(params.numCtx).toBe(16384);
  });
});
