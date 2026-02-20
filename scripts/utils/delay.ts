/**
 * Delay execution for the specified milliseconds.
 * Used for rate limiting between API calls.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delay with a random jitter to avoid predictable request patterns.
 * The actual delay will be between ms and ms + jitterMs.
 */
export function delayWithJitter(ms: number, jitterMs: number): Promise<void> {
  const actual = ms + Math.floor(Math.random() * jitterMs);
  return delay(actual);
}
