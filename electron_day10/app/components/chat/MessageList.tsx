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
