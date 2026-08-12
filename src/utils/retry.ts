export interface RetryOptions {
  retries: number;
  delayMs?: number;
  onRetry?: (error: unknown, attempt: number) => void;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === options.retries) break;
      options.onRetry?.(error, attempt + 1);
      const waitMs = (options.delayMs ?? 250) * 2 ** attempt;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
