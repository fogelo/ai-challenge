# CLI Агент - День 1

Простой интерактивный CLI агент для взаимодействия с LLM через OpenRouter API.

## Возможности

- Интерактивная REPL сессия
- Сохранение контекста диалога
- Поддержка различных моделей через OpenRouter
- Цветной вывод в терминале

## Установка

1. Установите зависимости:
```bash
npm install
```

2. Создайте `.env` файл на основе `.env.example`:
```bash
cp .env.example .env
```

3. Укажите ваш OpenRouter API ключ в `.env`:
```
OPENROUTER_API_KEY=your_api_key_here
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
```

## Использование

Запустите агент:
```bash
npm start
```

Введите ваше сообщение и нажмите Enter. Для выхода используйте Ctrl+C.

## Архитектура

```
src/
├── index.tsx              # Точка входа
├── components/
│   └── Chat.tsx           # Ink UI компонент
├── api/
│   └── openrouter.ts      # OpenRouter API клиент
├── chat/
│   └── conversation.ts    # Управление историей
└── types/
    └── index.ts           # TypeScript типы
```

## Технологии

- TypeScript
- Ink (React для CLI)
- OpenRouter API
- dotenv
