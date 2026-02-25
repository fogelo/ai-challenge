/**
 * Type definitions for OpenRouter API interactions and metrics tracking.
 * @module types
 */

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Per-message metadata for tracking API metrics and costs.
 * Attached to individual assistant messages for granular monitoring.
 */
export interface MessageMetadata {
  /**
   * Token usage breakdown (prompt/completion/total)
   */
  usage?: UsageInfo;
  /**
   * Response time in seconds
   */
  responseTime?: number;
  /**
   * Cost in USD
   */
  cost?: number;
  /**
   * Model ID used for this message
   */
  model?: string;
  /**
   * ISO 8601 timestamp
   */
  timestamp?: string;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenRouterRequest {
  /**
   * Model identifier to use for completion
   */
  model: string;
  messages: Message[];
  /**
   * Sampling temperature (0-2). Higher values make output more random.
   */
  temperature?: number;
}

export interface OpenRouterResponse {
  choices: Array<{
    message: {
      role: 'user' | 'assistant' | 'system';
      content: string;
    };
  }>;
  usage?: UsageInfo;
}

export interface ApiResponse {
  content: string;
  usage?: UsageInfo;
  /**
   * Response time in seconds
   */
  responseTime: number;
}

/**
 * Internal type for tracking session-level aggregated statistics
 */
export interface SessionStats {
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  /**
   * Total cost in USD
   */
  totalCost: number;
  requestCount: number;
}

/**
 * OpenRouter model information from /api/v1/models endpoint
 */
export interface ModelInfo {
  id: string;
  name: string;
  pricing: {
    prompt: string;      // price per token in USD
    completion: string;  // price per token in USD
  };
  context_length?: number;
}

/**
 * OpenRouter models API response
 */
export interface ModelsApiResponse {
  data: ModelInfo[];
}

/**
 * User's model configuration stored in config.json
 */
export interface ModelConfig {
  currentModel: string;
  favoriteModels: string[];
}

/**
 * Complete session data stored in JSON files
 */
export interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  stats: SessionStats;
}

/**
 * Metadata for listing sessions (lighter than full SessionData)
 */
export interface SessionMetadata {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}
