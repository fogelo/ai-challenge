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
