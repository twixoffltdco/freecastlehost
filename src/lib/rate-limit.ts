/**
 * lib/rate-limit.ts — простейший in-memory rate limiter (скользящее окно).
 * Защита API от абьюза. Замечание: на serverless (Vercel) состояние живёт
 * в пределах одной «тёплой» функции; для строгой защиты используйте Upstash Redis.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Проверяет, не превысил ли ключ (обычно IP клиента) лимит запросов.
 * @param key идентификатор клиента
 * @param windowMs размер окна в миллисекундах
 * @param max максимум запросов в окне
 */
export function rateLimit(key: string, windowMs = 60_000, max = 20): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, retryAfterSec: 0 };
  }

  bucket.count += 1;
  const ok = bucket.count <= max;
  return {
    ok,
    remaining: Math.max(0, max - bucket.count),
    retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
  };
}

/** Достаём IP клиента из заголовков прокси/серверлесс-платформ. */
export function clientKeyFromHeaders(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  const ip = fwd ? fwd.split(',')[0].trim() : headers.get('x-real-ip') ?? 'unknown';
  return ip || 'unknown';
}
