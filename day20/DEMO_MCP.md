# Demo: MCP Orchestration — Несколько серверов

## Архитектура

Агент подключается к 4 MCP серверам одновременно:

| Сервер | Инструменты |
|---|---|
| server-web | search |
| server-ai | summarize |
| server-files | saveToFile, readFile, listFiles |
| server-utils | get_time, echo, git_status, get_todos, reminders, ... |

## Запуск

```bash
npm start
```

## Сценарий демонстрации

### 1. Подключиться ко всем серверам

```
/mcp
```

**Ожидаемый результат:**
```
✅ MCP серверы подключены (4)

📡 server-web (1):
  🔧 search

📡 server-ai (1):
  🔧 summarize

📡 server-files (3):
  🔧 saveToFile
  🔧 readFile
  🔧 listFiles

📡 server-utils (12):
  🔧 get_time
  🔧 echo
  ...
```

---

### 2. Длинный флоу через 3 сервера

```
Скачай страницу https://docs.anthropic.com/en/home, суммаризируй на русском и сохрани в файл anthropic.md
```

**Что происходит (видно в чате):**
```
🔧 [server-web] › search
   Anthropic is an AI safety company...

🔧 [server-ai] › summarize
   Anthropic — компания по исследованию безопасности ИИ...

🔧 [server-files] › saveToFile
   ✅ Сохранено: .../output/anthropic.md
```

Три разных сервера, три последовательных вызова, явная маршрутизация.

---

### 3. Отдельный вызов утилиты (server-utils)

```
Какое сейчас время?
```

```
🔧 [server-utils] › get_time
   15 марта 2026 г., 14:30:00
```

---

### 4. Прочитать сохранённый файл (server-files)

```
Покажи список файлов и прочитай anthropic.md
```

```
🔧 [server-files] › listFiles
🔧 [server-files] › readFile
```

---

### 5. Отключиться

```
/mcp disconnect
```

## Что демонстрирует

- ✅ Несколько MCP серверов зарегистрированы одновременно
- ✅ Агент выбирает правильный инструмент из правильного сервера
- ✅ Корректная маршрутизация запросов
- ✅ Длинный флоу с инструментами из разных серверов
- ✅ Визуальная атрибуция: статус + лог в чате
