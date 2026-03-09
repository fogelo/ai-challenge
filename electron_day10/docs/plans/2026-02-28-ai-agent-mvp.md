# AI Agent MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Создать базовый AI чат-агент с интеграцией OpenRouter API, сохранением истории и type-safe IPC через Conveyor.

**Architecture:** Используем существующую Conveyor систему для безопасного IPC между renderer и main process. Zustand для state management в UI. OpenRouter API вызовы происходят в main process с сохранением истории в JSON файлы в userData директории.

**Tech Stack:** Electron, React 19, TypeScript, Zustand, Zod, Conveyor IPC, OpenRouter API, Shadcn UI, TailwindCSS, react-markdown

---

## Task 1: Создать типы и интерфейсы для чата

**Files:**
- Create: `app/types/chat.ts`

**Step 1: Создать файл с типами**

```typescript
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface ChatHistory {
  messages: Message[]
}

export interface AIConfig {
  openrouter: {
    apiKey: string
    model: string
    temperature: number
    maxTokens: number
  }
}

export interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface OpenRouterRequest {
  model: string
  messages: OpenRouterMessage[]
  temperature?: number
  max_tokens?: number
}

export interface OpenRouterResponse {
  id: string
  choices: Array<{
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
```

**Step 2: Commit**

```bash
git add app/types/chat.ts
git commit -m "feat: add chat type definitions"
```

---

## Task 2: Создать Conveyor AI Schema

**Files:**
- Create: `lib/conveyor/schemas/ai-schema.ts`
- Modify: `lib/conveyor/schemas/index.ts:6-9`

**Step 1: Создать AI schema с Zod валидацией**

```typescript
import { z } from 'zod'

const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.number(),
})

const ConfigSchema = z.object({
  openrouter: z.object({
    apiKey: z.string(),
    model: z.string(),
    temperature: z.number(),
    maxTokens: z.number(),
  }),
})

export const aiIpcSchema = {
  'ai:send-message': {
    args: z.tuple([z.string(), z.array(MessageSchema)]),
    return: MessageSchema,
  },
  'ai:load-history': {
    args: z.tuple([]),
    return: z.array(MessageSchema),
  },
  'ai:clear-history': {
    args: z.tuple([]),
    return: z.void(),
  },
  'ai:load-config': {
    args: z.tuple([]),
    return: ConfigSchema,
  },
} as const
```

**Step 2: Добавить ai-schema в index.ts**

В файле `lib/conveyor/schemas/index.ts` добавить импорт и включить в ipcSchemas:

```typescript
import { z } from 'zod'
import { windowIpcSchema } from './window-schema'
import { appIpcSchema } from './app-schema'
import { aiIpcSchema } from './ai-schema'

// Define all IPC channel schemas in one place
export const ipcSchemas = {
  ...windowIpcSchema,
  ...appIpcSchema,
  ...aiIpcSchema,
} as const

// ... остальной код без изменений
```

**Step 3: Commit**

```bash
git add lib/conveyor/schemas/ai-schema.ts lib/conveyor/schemas/index.ts
git commit -m "feat: add AI IPC schemas with Zod validation"
```

---

## Task 3: Создать сервис для работы с файловой системой

**Files:**
- Create: `lib/main/services/storage.ts`

**Step 1: Создать storage сервис**

```typescript
import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import type { Message, AIConfig, ChatHistory } from '@/app/types/chat'

const getUserDataPath = () => app.getPath('userData')
const getConfigPath = () => join(getUserDataPath(), 'config.json')
const getHistoryPath = () => join(getUserDataPath(), 'chat-history.json')

/**
 * Загрузить конфигурацию из файла
 */
export async function loadConfig(): Promise<AIConfig> {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    throw new Error(
      `Configuration file not found. Please create config.json at: ${configPath}\n\n` +
        'Example config:\n' +
        JSON.stringify(
          {
            openrouter: {
              apiKey: 'sk-or-v1-...',
              model: 'anthropic/claude-3.5-sonnet',
              temperature: 0.7,
              maxTokens: 4096,
            },
          },
          null,
          2
        )
    )
  }

  try {
    const data = await readFile(configPath, 'utf-8')
    return JSON.parse(data) as AIConfig
  } catch (error) {
    throw new Error(`Failed to read config file: ${error}`)
  }
}

/**
 * Загрузить историю чата из файла
 */
export async function loadHistory(): Promise<Message[]> {
  const historyPath = getHistoryPath()

  if (!existsSync(historyPath)) {
    return []
  }

  try {
    const data = await readFile(historyPath, 'utf-8')
    const history: ChatHistory = JSON.parse(data)
    return history.messages || []
  } catch (error) {
    console.error('Failed to load history, returning empty array:', error)
    return []
  }
}

/**
 * Сохранить историю чата в файл
 */
export async function saveHistory(messages: Message[]): Promise<void> {
  const historyPath = getHistoryPath()
  const history: ChatHistory = { messages }

  try {
    // Ensure directory exists
    const dir = getUserDataPath()
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    await writeFile(historyPath, JSON.stringify(history, null, 2), 'utf-8')
  } catch (error) {
    console.error('Failed to save history:', error)
    throw new Error(`Failed to save chat history: ${error}`)
  }
}

/**
 * Очистить историю чата
 */
export async function clearHistory(): Promise<void> {
  await saveHistory([])
}
```

**Step 2: Commit**

```bash
git add lib/main/services/storage.ts
git commit -m "feat: add storage service for config and history"
```

---

## Task 4: Создать сервис для работы с OpenRouter API

**Files:**
- Create: `lib/main/services/openrouter.ts`

**Step 1: Установить зависимость для HTTP запросов**

Electron уже имеет встроенный fetch, используем его.

**Step 2: Создать OpenRouter сервис**

```typescript
import type { AIConfig, OpenRouterRequest, OpenRouterResponse, Message } from '@/app/types/chat'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Отправить запрос к OpenRouter API
 */
export async function sendMessageToOpenRouter(
  userMessage: string,
  history: Message[],
  config: AIConfig
): Promise<string> {
  const messages = [
    ...history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
    {
      role: 'user' as const,
      content: userMessage,
    },
  ]

  const requestBody: OpenRouterRequest = {
    model: config.openrouter.model,
    messages,
    temperature: config.openrouter.temperature,
    max_tokens: config.openrouter.maxTokens,
  }

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openrouter.apiKey}`,
        'HTTP-Referer': 'https://github.com/your-repo', // Optional
        'X-Title': 'AI Agent MVP', // Optional
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`)
    }

    const data: OpenRouterResponse = await response.json()

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response from OpenRouter API')
    }

    const assistantMessage = data.choices[0].message.content

    if (!assistantMessage) {
      throw new Error('Empty response from OpenRouter API')
    }

    return assistantMessage
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`OpenRouter API call failed: ${error.message}`)
    }
    throw new Error('Unknown error during OpenRouter API call')
  }
}
```

**Step 3: Commit**

```bash
git add lib/main/services/openrouter.ts
git commit -m "feat: add OpenRouter API service"
```

---

## Task 5: Создать AI handler для Conveyor

**Files:**
- Create: `lib/conveyor/handlers/ai-handler.ts`
- Modify: `lib/main/app.ts:6,32`

**Step 1: Создать AI handler**

```typescript
import { handle } from '@/lib/main/shared'
import { loadConfig, loadHistory, saveHistory, clearHistory } from '@/lib/main/services/storage'
import { sendMessageToOpenRouter } from '@/lib/main/services/openrouter'
import type { Message } from '@/app/types/chat'
import { randomUUID } from 'crypto'

export const registerAiHandlers = () => {
  /**
   * Отправить сообщение в LLM и получить ответ
   */
  handle('ai:send-message', async (userMessage: string, history: Message[]): Promise<Message> => {
    try {
      // Load config
      const config = await loadConfig()

      // Call OpenRouter API
      const assistantContent = await sendMessageToOpenRouter(userMessage, history, config)

      // Create assistant message
      const assistantMessage: Message = {
        id: randomUUID(),
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now(),
      }

      // Create user message (it's already added in UI, but we need it for saving)
      const userMsg: Message = {
        id: randomUUID(),
        role: 'user',
        content: userMessage,
        timestamp: Date.now() - 1, // 1ms earlier to ensure correct order
      }

      // Save updated history (history from UI + new user message + new assistant message)
      const updatedHistory = [...history, userMsg, assistantMessage]
      await saveHistory(updatedHistory)

      return assistantMessage
    } catch (error) {
      console.error('Error in ai:send-message handler:', error)
      throw error
    }
  })

  /**
   * Загрузить историю чата
   */
  handle('ai:load-history', async (): Promise<Message[]> => {
    try {
      return await loadHistory()
    } catch (error) {
      console.error('Error in ai:load-history handler:', error)
      return []
    }
  })

  /**
   * Очистить историю чата
   */
  handle('ai:clear-history', async (): Promise<void> => {
    try {
      await clearHistory()
    } catch (error) {
      console.error('Error in ai:clear-history handler:', error)
      throw error
    }
  })

  /**
   * Загрузить конфигурацию
   */
  handle('ai:load-config', async () => {
    try {
      return await loadConfig()
    } catch (error) {
      console.error('Error in ai:load-config handler:', error)
      throw error
    }
  })
}
```

**Step 2: Зарегистрировать AI handlers в app.ts**

В файле `lib/main/app.ts` добавить импорт и регистрацию:

```typescript
import { BrowserWindow, shell, app } from 'electron'
import { join } from 'path'
import appIcon from '@/resources/build/icon.png?asset'
import { registerResourcesProtocol } from './protocols'
import { registerWindowHandlers } from '@/lib/conveyor/handlers/window-handler'
import { registerAppHandlers } from '@/lib/conveyor/handlers/app-handler'
import { registerAiHandlers } from '@/lib/conveyor/handlers/ai-handler'

export function createAppWindow(): void {
  // Register custom protocol for resources
  registerResourcesProtocol()

  // Create the main window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    backgroundColor: '#1c1c1c',
    icon: appIcon,
    frame: false,
    titleBarStyle: 'hiddenInset',
    title: 'AI Agent',
    maximizable: false,
    resizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false,
    },
  })

  // Register IPC events for the main window.
  registerWindowHandlers(mainWindow)
  registerAppHandlers(app)
  registerAiHandlers()

  // ... остальной код без изменений
```

**Step 3: Commit**

```bash
git add lib/conveyor/handlers/ai-handler.ts lib/main/app.ts
git commit -m "feat: add AI IPC handlers and register in app"
```

---

## Task 6: Создать AI API для renderer process

**Files:**
- Create: `lib/conveyor/api/ai-api.ts`
- Modify: `lib/conveyor/api/index.ts:2,7`

**Step 1: Создать AI API класс**

```typescript
import { ConveyorApi } from '@/lib/preload/shared'
import type { Message, AIConfig } from '@/app/types/chat'

export class AiApi extends ConveyorApi {
  sendMessage = (message: string, history: Message[]) =>
    this.invoke('ai:send-message', message, history)

  loadHistory = () => this.invoke('ai:load-history')

  clearHistory = () => this.invoke('ai:clear-history')

  loadConfig = () => this.invoke('ai:load-config')
}
```

**Step 2: Добавить ai в conveyor api**

В файле `lib/conveyor/api/index.ts`:

```typescript
import { electronAPI } from '@electron-toolkit/preload'
import { AppApi } from './app-api'
import { WindowApi } from './window-api'
import { AiApi } from './ai-api'

export const conveyor = {
  app: new AppApi(electronAPI),
  window: new WindowApi(electronAPI),
  ai: new AiApi(electronAPI),
}

export type ConveyorApi = typeof conveyor
```

**Step 3: Commit**

```bash
git add lib/conveyor/api/ai-api.ts lib/conveyor/api/index.ts
git commit -m "feat: add AI API to conveyor for renderer process"
```

---

## Task 7: Создать Zustand store для чата

**Files:**
- Create: `app/stores/useChatStore.ts`

**Step 1: Установить необходимые пакеты**

Zustand уже установлен (package.json показывает zustand@5.0.11).

**Step 2: Создать chat store**

```typescript
import { create } from 'zustand'
import type { Message } from '@/app/types/chat'

interface ChatStore {
  messages: Message[]
  isLoading: boolean
  error: string | null

  // Actions
  addMessage: (message: Message) => void
  setMessages: (messages: Message[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isLoading: false,
  error: null,

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  setMessages: (messages) =>
    set({
      messages,
    }),

  setLoading: (loading) =>
    set({
      isLoading: loading,
    }),

  setError: (error) =>
    set({
      error,
    }),

  clearMessages: () =>
    set({
      messages: [],
      error: null,
    }),
}))
```

**Step 3: Commit**

```bash
git add app/stores/useChatStore.ts
git commit -m "feat: add Zustand chat store"
```

---

## Task 8: Создать компонент MessageItem

**Files:**
- Create: `app/components/chat/MessageItem.tsx`

**Step 1: Установить react-markdown**

```bash
npm install react-markdown
```

**Step 2: Создать компонент MessageItem**

```typescript
import type { Message } from '@/app/types/chat'
import { Badge } from '@/app/components/ui/badge'
import ReactMarkdown from 'react-markdown'

interface MessageItemProps {
  message: Message
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  return (
    <div className={`mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <Badge variant={isUser ? 'default' : isSystem ? 'outline' : 'secondary'} className="mb-1">
          {isUser ? 'You' : isSystem ? 'System' : 'AI'}
        </Badge>
        <div
          className={`rounded-lg px-4 py-3 ${
            isUser
              ? 'bg-primary text-primary-foreground'
              : isSystem
                ? 'bg-muted text-muted-foreground'
                : 'bg-secondary text-secondary-foreground'
          }`}
        >
          <ReactMarkdown className="prose prose-sm dark:prose-invert max-w-none">
            {message.content}
          </ReactMarkdown>
        </div>
        <span className="mt-1 text-xs text-muted-foreground">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  )
}
```

**Step 3: Commit**

```bash
npm install react-markdown
git add package.json package-lock.json app/components/chat/MessageItem.tsx
git commit -m "feat: add MessageItem component with markdown support"
```

---

## Task 9: Создать компонент MessageList

**Files:**
- Create: `app/components/chat/MessageList.tsx`

**Step 1: Создать компонент MessageList**

```typescript
import { useEffect, useRef } from 'react'
import type { Message } from '@/app/types/chat'
import { MessageItem } from './MessageItem'
import { ScrollArea } from '@/app/components/ui/scroll-area'

interface MessageListProps {
  messages: Message[]
  isLoading: boolean
}

export function MessageList({ messages, isLoading }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading])

  return (
    <ScrollArea className="flex-1 px-4" ref={scrollRef}>
      {messages.length === 0 && !isLoading && (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <p>Start a conversation with AI</p>
        </div>
      )}

      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}

      {isLoading && (
        <div className="mb-4 flex justify-start">
          <div className="flex items-center gap-2 rounded-lg bg-secondary px-4 py-3">
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary"></div>
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary delay-75"></div>
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary delay-150"></div>
          </div>
        </div>
      )}
    </ScrollArea>
  )
}
```

**Step 2: Commit**

```bash
git add app/components/chat/MessageList.tsx
git commit -m "feat: add MessageList component with auto-scroll"
```

---

## Task 10: Создать компонент ChatInput

**Files:**
- Create: `app/components/chat/ChatInput.tsx`

**Step 1: Создать компонент ChatInput**

```typescript
import { useState, KeyboardEvent } from 'react'
import { Button } from '@/app/components/ui/button'

interface ChatInputProps {
  onSendMessage: (message: string) => void
  disabled: boolean
}

export function ChatInput({ onSendMessage, disabled }: ChatInputProps) {
  const [input, setInput] = useState('')

  const handleSend = () => {
    const trimmed = input.trim()
    if (trimmed && !disabled) {
      onSendMessage(trimmed)
      setInput('')
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t p-4">
      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
          className="min-h-[60px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          rows={2}
        />
        <Button onClick={handleSend} disabled={disabled || !input.trim()} className="self-end">
          Send
        </Button>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add app/components/chat/ChatInput.tsx
git commit -m "feat: add ChatInput component with Enter/Shift+Enter handling"
```

---

## Task 11: Создать главный компонент ChatContainer

**Files:**
- Create: `app/components/chat/ChatContainer.tsx`

**Step 1: Создать ChatContainer**

```typescript
import { useEffect } from 'react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { useChatStore } from '@/app/stores/useChatStore'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import type { Message } from '@/app/types/chat'

export default function ChatContainer() {
  const conveyor = useConveyor()
  const { messages, isLoading, error, addMessage, setMessages, setLoading, setError } = useChatStore()

  // Load history on mount
  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async () => {
    try {
      const history = await conveyor.ai.loadHistory()
      setMessages(history)
    } catch (err) {
      console.error('Failed to load history:', err)
      setError('Failed to load chat history')
    }
  }

  const handleSendMessage = async (content: string) => {
    // Create user message (using Web Crypto API for UUID generation)
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }

    // Add user message to UI immediately
    addMessage(userMessage)
    setLoading(true)
    setError(null)

    try {
      // Send to AI (it will save the updated history)
      const assistantMessage = await conveyor.ai.sendMessage(content, messages)

      // Add assistant response to UI
      addMessage(assistantMessage)
    } catch (err) {
      console.error('Failed to send message:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message'
      setError(errorMessage)

      // Add error as system message
      const systemMessage: Message = {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error: ${errorMessage}`,
        timestamp: Date.now(),
      }
      addMessage(systemMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen flex-col">
      {error && (
        <div className="border-b border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <MessageList messages={messages} isLoading={isLoading} />

      <ChatInput onSendMessage={handleSendMessage} disabled={isLoading} />
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add app/components/chat/ChatContainer.tsx
git commit -m "feat: add ChatContainer with message handling logic"
```

---

## Task 12: Заменить WelcomeKit на ChatContainer

**Files:**
- Modify: `app/app.tsx`

**Step 1: Заменить содержимое app.tsx**

```typescript
import ChatContainer from '@/app/components/chat/ChatContainer'
import './styles/app.css'

export default function App() {
  return <ChatContainer />
}
```

**Step 2: Commit**

```bash
git add app/app.tsx
git commit -m "feat: replace WelcomeKit with ChatContainer"
```

---

## Task 13: Создать пример конфигурационного файла

**Files:**
- Create: `config.example.json`
- Create: `.gitignore` entry for config.json

**Step 1: Создать пример конфига в корне проекта**

```json
{
  "openrouter": {
    "apiKey": "sk-or-v1-YOUR-API-KEY-HERE",
    "model": "anthropic/claude-3.5-sonnet",
    "temperature": 0.7,
    "maxTokens": 4096
  }
}
```

**Step 2: Обновить .gitignore**

Добавить в `.gitignore`:

```
# User config with API keys
config.json
```

**Step 3: Commit**

```bash
git add config.example.json .gitignore
git commit -m "docs: add example config and gitignore config.json"
```

---

## Task 14: Обновить README с инструкциями

**Files:**
- Modify: `README.md`

**Step 1: Добавить секцию Configuration в README**

В файл `README.md` после секции Installation добавить:

```markdown
## Configuration

Before running the application, you need to create a configuration file with your OpenRouter API key.

### Step 1: Get OpenRouter API Key

1. Go to [OpenRouter](https://openrouter.ai)
2. Sign up or log in
3. Generate an API key

### Step 2: Create Configuration File

1. Copy the example configuration:
   ```bash
   cp config.example.json config.json
   ```

2. Edit `config.json` and add your API key:
   ```json
   {
     "openrouter": {
       "apiKey": "sk-or-v1-YOUR-API-KEY-HERE",
       "model": "anthropic/claude-3.5-sonnet",
       "temperature": 0.7,
       "maxTokens": 4096
     }
   }
   ```

3. The `config.json` file will be automatically used by the application and is gitignored for security.

**Available Models:**
- `anthropic/claude-3.5-sonnet` (recommended)
- `openai/gpt-4`
- `google/gemini-pro`
- See [OpenRouter models](https://openrouter.ai/models) for more options

**Configuration Options:**
- `apiKey`: Your OpenRouter API key (required)
- `model`: The AI model to use (required)
- `temperature`: Controls randomness (0.0 to 1.0, default: 0.7)
- `maxTokens`: Maximum response length (default: 4096)

<br />
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add configuration instructions to README"
```

---

## Task 15: Финальное тестирование

**Files:**
- Test: Application functionality

**Step 1: Сборка и запуск приложения**

```bash
npm install
npm run dev
```

**Expected:** Приложение запускается и показывает пустой чат интерфейс.

**Step 2: Тест без config.json**

1. Убедиться что config.json не существует
2. Отправить сообщение
3. **Expected:** Появляется системное сообщение с ошибкой и путем к файлу конфигурации

**Step 3: Создать config.json и тестировать**

1. Создать config.json с валидным API ключом
2. Перезапустить приложение
3. Отправить сообщение "Hello"
4. **Expected:** Появляется индикатор загрузки, затем ответ от AI

**Step 4: Тест персистентности**

1. Отправить несколько сообщений
2. Закрыть приложение
3. Открыть снова
4. **Expected:** История чата загрузилась и отображается

**Step 5: Проверить файлы**

```bash
# Найти userData директорию
# macOS: ~/Library/Application Support/era
# Windows: %APPDATA%/era
# Linux: ~/.config/era

cat ~/Library/Application\ Support/era/chat-history.json
cat ~/Library/Application\ Support/era/config.json
```

**Expected:** Файлы существуют и содержат корректные данные.

**Step 6: Commit если всё работает**

```bash
git add .
git commit -m "test: verify AI agent MVP functionality"
```

---

## Критерии завершения

- [ ] Приложение компилируется без ошибок
- [ ] Можно отправить сообщение и получить ответ от LLM
- [ ] История сохраняется и загружается между сессиями
- [ ] Ошибки обрабатываются и отображаются понятно
- [ ] Config загружается из JSON файла
- [ ] UI показывает состояния загрузки
- [ ] Markdown форматирование работает в сообщениях
- [ ] Enter отправляет, Shift+Enter создает новую строку

---

## Следующие шаги (Future Iterations)

1. Добавить streaming ответов через SSE
2. Создать UI для настроек (modal или отдельная страница)
3. Добавить sidebar с множественными чатами
4. Реализовать syntax highlighting для кода
5. Добавить контекст файлов для работы с кодом
6. Encryption для API ключа
7. Unit и E2E тесты

---

## Troubleshooting

**Проблема: "Module not found" ошибки**
- Решение: Убедитесь что все зависимости установлены (`npm install`)

**Проблема: API ключ не работает**
- Решение: Проверьте формат ключа, убедитесь что он начинается с `sk-or-v1-`

**Проблема: История не сохраняется**
- Решение: Проверьте права доступа к userData директории

**Проблема: Приложение не компилируется**
- Решение: Очистите кеш (`rm -rf node_modules dist out && npm install`)
