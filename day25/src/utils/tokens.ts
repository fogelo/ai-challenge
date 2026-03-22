import { Message } from '../types/index.js';

/**
 * Approximate token count for messages
 * Rule: ~4 chars = 1 token (Latin), ~2-3 chars = 1 token (Cyrillic)
 * Using conservative estimate of 3 chars per token average
 */
export function calculateApproximateTokens(messages: Message[]): number {
  const totalChars = messages.reduce((sum, msg) => {
    return sum + msg.content.length;
  }, 0);

  return Math.ceil(totalChars / 3);
}
