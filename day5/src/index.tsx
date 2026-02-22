#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import dotenv from 'dotenv';
import { Chat } from './components/Chat.js';
import { ModelRegistry } from './models/registry.js';
import { ConfigManager } from './models/config.js';

// Загрузка переменных окружения
dotenv.config();

// Проверка наличия необходимых переменных
if (!process.env.OPENROUTER_API_KEY) {
  console.error('Ошибка: OPENROUTER_API_KEY не найден в .env файле');
  console.error('Создайте .env файл на основе .env.example и укажите ваш API ключ');
  process.exit(1);
}

// Initialize model services
(async () => {
  console.log('Loading models from OpenRouter...');
  const modelRegistry = new ModelRegistry();
  await modelRegistry.initialize();

  const configManager = new ConfigManager();
  const config = configManager.getConfig();

  console.log(`Current model: ${config.currentModel}`);
  console.log('Starting chat...\n');

  // Запуск приложения
  render(<Chat modelRegistry={modelRegistry} configManager={configManager} />);
})();
