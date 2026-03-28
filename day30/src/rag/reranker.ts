import type { SearchResult } from './types.js';

export interface FilterOptions {
  threshold: number;
  topKInitial: number;
  topKFinal: number;
}

export const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  threshold: 0.5,
  topKInitial: 10,
  topKFinal: 5,
};

export function filterByThreshold(
  results: SearchResult[],
  threshold: number,
): SearchResult[] {
  if (results.length === 0) return [];
  const filtered = results.filter((r) => r.score >= threshold);
  if (filtered.length === 0) return [results[0]];
  return filtered;
}
