export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface OpenRouterRequest {
  model: string;
  messages: Message[];
}

export interface OpenRouterResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
  }>;
}
