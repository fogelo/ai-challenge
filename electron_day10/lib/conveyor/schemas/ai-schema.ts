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
