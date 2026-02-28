import { ConveyorApi } from '@/lib/preload/shared'
import type { Message, AIConfig } from '@/app/types/chat'

export class AiApi extends ConveyorApi {
  sendMessage = (message: string, history: Message[]) =>
    this.invoke('ai:send-message', message, history)

  loadHistory = () => this.invoke('ai:load-history')

  clearHistory = () => this.invoke('ai:clear-history')

  loadConfig = () => this.invoke('ai:load-config')
}
