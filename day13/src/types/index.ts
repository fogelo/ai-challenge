/**
 * Type definitions for OpenRouter API interactions and metrics tracking.
 * @module types
 */

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: MessageMetadata;  // новое поле
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
 * Configuration for context summarization
 */
export interface SummarizationConfig {
  /**
   * Threshold percentage (0.0 to 1.0) for triggering summarization
   * Example: 0.7 = 70% context usage
   */
  threshold: number;
  /**
   * Number of recent messages to keep as-is (not summarized)
   */
  keepRecentMessages: number;
}

/**
 * Strategy types for context management
 */
export type StrategyType = 'sliding' | 'facts' | 'branching';

/**
 * Strategy configuration in config.json
 */
export interface StrategyConfig {
  default: StrategyType;
  slidingWindow: {
    size: number;
  };
  stickyFacts: {
    windowSize: number;
    extractionModel?: string;
  };
  branching: {
    maxCheckpoints?: number;
  };
}

/**
 * User's model configuration stored in config.json
 */
export interface ModelConfig {
  currentModel: string;
  favoriteModels: string[];
  summarization: SummarizationConfig;
  strategy: StrategyConfig;
}

/**
 * Complete session data stored in JSON files
 */
export interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  summary?: string;
  needsSummarization?: boolean;
  stats: SessionStats;
  strategyState?: StrategyState;
  taskStateId?: string;
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
  taskState?: string;
  taskDescription?: string;
}

/**
 * Base state for all strategies
 */
export interface BaseStrategyState {
  type: StrategyType;
  messages: Message[];
}

/**
 * Sliding Window strategy state
 */
export interface SlidingWindowState extends BaseStrategyState {
  type: 'sliding';
  windowSize: number;
}

/**
 * Sticky Facts strategy state
 */
export interface StickyFactsState extends BaseStrategyState {
  type: 'facts';
  facts: Record<string, string>;
  windowSize: number;
  lastFactsUpdate: number;
}

/**
 * Checkpoint for branching
 */
export interface Checkpoint {
  id: string;
  timestamp: number;
  messageIndex: number;
  name?: string;
}

/**
 * Branch in conversation
 */
export interface Branch {
  id: string;
  name: string;
  checkpointId: string;
  messages: Message[];
  createdAt: number;
}

/**
 * Branching strategy state
 */
export interface BranchingState extends BaseStrategyState {
  type: 'branching';
  checkpoints: Checkpoint[];
  branches: Branch[];
  currentBranchId: string | null;
}

/**
 * Union type for all strategy states
 */
export type StrategyState = SlidingWindowState | StickyFactsState | BranchingState;
