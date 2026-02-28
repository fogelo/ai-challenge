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
