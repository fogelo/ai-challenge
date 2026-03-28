# День 30: Локальная LLM как приватный сервис

**Дата:** 2026-03-28
**Статус:** Approved

## Цель

Развернуть локальную LLM на VPS как приватный сервис с HTTP API, расширить CLI-агент для работы с удалённым Ollama, добавить rate limiting и проверку контекста на стороне агента.

## Архитектура

```
[CLI Агент] ──HTTP──► [Hetzner VPS :11434] ──► [llama3.1:8b]
     │                  Helsinki, 8GB RAM
     └─ config.json: ollamaBaseUrl = "http://<vps-ip>:11434"
```

**Сервер:** Hetzner VPS, 4 vCPU, 8GB RAM, 80GB SSD, Helsinki
**Доступ:** порт 11434 открыт публично (временно, только на время демо)
**Модель:** `llama3.1:8b` (~4.7GB, CPU-only инференс ~5-10 tok/s)

## Серверная часть (настройка VPS, не код)

1. Установка Ollama: `curl -fsSL https://ollama.com/install.sh | sh`
2. Открыть порт: `ufw allow 11434`
3. Запуск с публичным биндингом: `OLLAMA_HOST=0.0.0.0 ollama serve`
4. Скачать модель: `ollama pull llama3.1:8b`
5. Проверить доступность: `curl http://<vps-ip>:11434/api/tags`

## Изменения в агенте

### 1. `src/utils/rateLimiter.ts` (новый файл)

Простой in-memory счётчик запросов. Конфигурируется через `config.json`:

```json
"rateLimit": {
  "maxRequestsPerMinute": 10
}
```

Логика: хранит timestamp последних N запросов, при превышении бросает ошибку с сообщением пользователю: `"Rate limit: подождите X секунд"`.

### 2. Проверка контекста перед отправкой

В `src/api/ollama.ts` перед fetch-запросом: если суммарный размер messages (в символах / 4 ≈ токены) превышает `numCtx` — вызвать суммаризацию. Предотвращает ошибки 400 от Ollama при переполнении контекста.

### 3. Команда `/ollama:status`

Показывает:
- текущий `ollamaBaseUrl`
- текущую модель
- счётчик rate limit (использовано X из Y за последнюю минуту)
- статус соединения (GET `/api/tags`)

### 4. Обновление config.json

```json
"ollamaBaseUrl": "http://<vps-ip>:11434",
"ollamaModel": "llama3.1:8b",
"rateLimit": {
  "maxRequestsPerMinute": 10
}
```

### 5. README с инструкцией по VPS

Добавить в `day30/README.md` раздел "Развёртывание на VPS" с пошаговой инструкцией.

## Что проверяем (по заданию)

| Требование | Реализация |
|---|---|
| Доступ к модели по сети | `ollamaBaseUrl` = `http://vps-ip:11434` |
| Стабильность при нескольких запросах | Проверяем вручную в ходе демо |
| Rate limit | `RateLimiter` в агенте, 10 req/min |
| Max context | Проверка `numCtx` перед отправкой |

## Компоненты и зависимости

```
config.json
    └── rateLimit.maxRequestsPerMinute

src/utils/rateLimiter.ts       ← новый
    └── RateLimiter class

src/api/ollama.ts              ← добавить context check
    └── import RateLimiter

src/models/config.ts           ← добавить rateLimit в DEFAULT_CONFIG
src/types/index.ts             ← добавить RateLimitConfig тип

src/components/Chat.tsx        ← добавить обработку команды /ollama:status
```

## Решения вне скоупа

- Nginx reverse proxy — не нужен, порт закрывается сразу после демо
- HTTPS / SSL — не нужен для временного учебного демо
- Серверный rate limiting — клиентского достаточно для одного пользователя
