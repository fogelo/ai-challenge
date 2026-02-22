#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import dotenv from 'dotenv';
import { Chat } from './components/Chat.js';

// Загрузка переменных окружения
dotenv.config();

// Проверка наличия необходимых переменных
if (!process.env.OPENROUTER_API_KEY) {
  console.error('Ошибка: OPENROUTER_API_KEY не найден в .env файле');
  console.error('Создайте .env файл на основе .env.example и укажите ваш API ключ');
  process.exit(1);
}

if (!process.env.OPENROUTER_MODEL) {
  console.error('Ошибка: OPENROUTER_MODEL не найден в .env файле');
  console.error('Создайте .env файл на основе .env.example и укажите модель');
  process.exit(1);
}

// Запуск приложения
render(<Chat />);
