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
