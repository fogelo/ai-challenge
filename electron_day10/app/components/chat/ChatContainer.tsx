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
