export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenRouterRequest {
  model: string;
  messages: Message[];
  temperature?: number;
}

export interface OpenRouterResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
  }>;
  usage?: UsageInfo;
}

export interface ApiResponse {
  content: string;
  usage?: UsageInfo;
  responseTime: number;
}

export interface SessionStats {
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  requestCount: number;
}
