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
