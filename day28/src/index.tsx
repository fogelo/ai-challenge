#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import dotenv from 'dotenv';
import { Chat } from './components/Chat.js';
import { ModelRegistry } from './models/registry.js';
import { ConfigManager } from './models/config.js';
import { initQuerier } from './rag/querier.js';

// Загрузка переменных окружения
dotenv.config();

(async () => {
  const configManager = new ConfigManager();
  const { provider } = configManager.getProviderConfig();

  if (provider === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
    console.error('Ошибка: OPENROUTER_API_KEY не найден в .env файле');
    console.error('Создайте .env файл на основе .env.example и укажите ваш API ключ');
    console.error('Или переключитесь на Ollama: отредактируйте config.json, установите "provider": "ollama"');
    process.exit(1);
  }

  initQuerier(configManager);

  const modelRegistry = new ModelRegistry();
  const config = configManager.getConfig();

  if (provider === 'openrouter') {
    console.log('Loading models from OpenRouter...');
    await modelRegistry.initialize();
    console.log(`Current model: ${config.currentModel}`);
  } else {
    const { ollamaModel, ollamaBaseUrl } = configManager.getProviderConfig();
    console.log(`Провайдер: Ollama (${ollamaBaseUrl})`);
    console.log(`Модель: ${ollamaModel}`);
  }

  console.log('Starting chat...\n');

  render(<Chat modelRegistry={modelRegistry} configManager={configManager} />);
})();
