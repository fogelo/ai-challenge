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
          className={`rounded-lg px-4 py-3 prose prose-sm dark:prose-invert max-w-none ${
            isUser
              ? 'bg-primary text-primary-foreground'
              : isSystem
                ? 'bg-muted text-muted-foreground'
                : 'bg-secondary text-secondary-foreground'
          }`}
        >
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
        <span className="mt-1 text-xs text-muted-foreground">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  )
}
