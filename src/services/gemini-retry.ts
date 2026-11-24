import { performance } from "node:perf_hooks";

export const GEMINI_MAX_RETRIES = 2;
export const GEMINI_RETRY_INITIAL_DELAY_MS = 300;
export const GEMINI_RETRY_MAX_DELAY_MS = 1_000;

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export class GeminiRequestDeadlineError extends Error {
  constructor() {
    super("Gemini request deadline exceeded");
    this.name = "GeminiRequestDeadlineError";
  }
}

export interface GeminiRetryFailure {
  attempt: number;
  maxAttempts: number;
  httpStatus: number | null;
  providerErrorCode: string | number | null;
  willRetry: boolean;
  retryDelayMs: number | null;
  requestDurationMs: number;
}

export interface GeminiRetryOptions {
  timeoutMs: number;
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  sleep?: (durationMs: number) => Promise<void>;
  onAttemptFailure?: (failure: GeminiRetryFailure, error: unknown) => void;
}

export interface GeminiAttemptContext {
  attempt: number;
  timeoutMs: number;
  signal: AbortSignal;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export function getGeminiHttpStatus(error: unknown): number | null {
  const details = record(error);
  const providerError = record(details.error);
  const rawResponse = record(details.rawResponse);
  for (const value of [details.status, details.statusCode, rawResponse.status, providerError.code]) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  return null;
}

export function getGeminiProviderErrorCode(error: unknown): string | number | null {
  const details = record(error);
  const providerError = record(details.error);
  const code = providerError.status ?? providerError.code
    ?? (typeof details.code === "string" ? details.code : null);
  return typeof code === "string" || typeof code === "number" ? code : null;
}

export function isRetryableGeminiError(error: unknown): boolean {
  const status = getGeminiHttpStatus(error);
  return status !== null && RETRYABLE_HTTP_STATUSES.has(status);
}

export function getGeminiRetryAfterMs(error: unknown, nowMs = Date.now()): number | null {
  const details = record(error);
  const rawResponse = record(details.rawResponse);
  const headers = record(details.headers ?? rawResponse.headers) as Headers & Record<string, unknown>;
  let value: unknown;
  try {
    value = typeof headers.get === "function" ? headers.get("retry-after") : headers["retry-after"];
  } catch {
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(0, retryAt - nowMs);
}

function defaultSleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function withDeadline<T>(
  operation: (context: GeminiAttemptContext) => Promise<T>,
  context: Omit<GeminiAttemptContext, "signal">,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const attemptContext = { ...context, signal: controller.signal };
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new GeminiRequestDeadlineError());
    }, context.timeoutMs);
    operation(attemptContext).then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

export async function withGeminiRetries<T>(
  operation: (context: GeminiAttemptContext) => Promise<T>,
  options: GeminiRetryOptions,
): Promise<T> {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? GEMINI_MAX_RETRIES;
  const initialDelayMs = options.initialDelayMs ?? GEMINI_RETRY_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? GEMINI_RETRY_MAX_DELAY_MS;
  const deadline = now() + options.timeoutMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const remainingMs = Math.floor(deadline - now());
    if (remainingMs <= 0) throw new GeminiRequestDeadlineError();

    const requestStartedAt = now();
    try {
      return await withDeadline(operation, {
        attempt: attempt + 1,
        timeoutMs: remainingMs,
      });
    } catch (error) {
      const requestDurationMs = Math.max(0, Math.round(now() - requestStartedAt));
      const retryable = isRetryableGeminiError(error);
      const canRetry = retryable && attempt < maxRetries;
      const retryAfterMs = retryable ? getGeminiRetryAfterMs(error) : null;
      const backoffMs = Math.min(maxDelayMs, initialDelayMs * (2 ** attempt));
      const retryDelayMs = retryAfterMs ?? backoffMs;
      const enoughTimeForRetry = deadline - now() > retryDelayMs;
      const willRetry = canRetry && enoughTimeForRetry;

      options.onAttemptFailure?.({
        attempt: attempt + 1,
        maxAttempts: maxRetries + 1,
        httpStatus: getGeminiHttpStatus(error),
        providerErrorCode: getGeminiProviderErrorCode(error),
        willRetry,
        retryDelayMs: willRetry ? retryDelayMs : null,
        requestDurationMs,
      }, error);

      if (!willRetry) throw error;
      await sleep(retryDelayMs);
      if (deadline - now() <= 0) throw error;
    }
  }

  throw new GeminiRequestDeadlineError();
}

