import { Message, StrategyState } from '../types/index.js';

/**
 * Interface for context management strategies.
 * Defines contract for how conversation history is managed and sent to API.
 */
export interface IContextStrategy {
  /**
   * Get messages to send to API (implements strategy-specific logic)
   */
  getMessagesForAPI(): Promise<Message[]>;

  /**
   * Add a new message to the strategy's storage
   */
  addMessage(message: Message): Promise<void>;

  /**
   * Clear all context
   */
  clear(): void;

  /**
   * Get strategy name for display
   */
  getName(): string;

  /**
   * Serialize strategy state for session persistence
   */
  serialize(): StrategyState;

  /**
   * Restore strategy from serialized state
   */
  restore(state: StrategyState): void;
}
