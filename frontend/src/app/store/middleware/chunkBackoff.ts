// Exponential backoff for chunk-fetch retries. Pure (no imports) so the math is
// unit-tested without timers or a store.

export const MAX_CHUNK_RETRY_ATTEMPTS = 5;
const BASE_MS = 1000;
const CAP_MS = 30_000;

// Delay before retry attempt `attempt` (0-based): 1s, 2s, 4s, 8s, 16s, then
// capped at 30s.
export function computeBackoffMs(attempt: number): number {
  const exp = BASE_MS * 2 ** Math.max(0, attempt);
  return Math.min(CAP_MS, exp);
}
