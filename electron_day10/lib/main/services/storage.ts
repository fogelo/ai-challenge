import { app } from 'electron'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import type { Message, AIConfig, ChatHistory } from '@/app/types/chat'

const getUserDataPath = () => app.getPath('userData')
const getConfigPath = () => {
  // В режиме разработки и production - config.json в корне проекта
  const appPath = app.getAppPath()
  return join(appPath, 'config.json')
}
const getHistoryPath = () => join(getUserDataPath(), 'chat-history.json')

/**
 * Загрузить конфигурацию из файла
 */
export async function loadConfig(): Promise<AIConfig> {
  const configPath = getConfigPath()

  if (!existsSync(configPath)) {
    throw new Error(
      `Configuration file not found.\n\n` +
        `Please create config.json in your project root or copy from config.example.json:\n` +
        `  cp config.example.json config.json\n\n` +
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
