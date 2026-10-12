/**
 * lib/crypto.ts — генерация ключей и токенов доступа.
 * Используется Web Crypto API (доступен и в браузере, и в Node.js 18+ / Edge Runtime).
 */

/**
 * Генерирует уникальный alphanumeric Friend Key вида f9eea118a6ef...
 * (криптостойкий hex-код на основе crypto.getRandomValues).
 * @param bytes количество байт энтропии (по умолчанию 12 → 24 hex-символов)
 */
export function generateFriendKey(bytes = 12): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Простейшая криптографическая подпись HMAC-SHA256 (для токенов доступа). */
async function hmac(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Создаёт токен доступа для дашборда: payload.signature.
 * payload = base64url(JSON({ uid, key, exp })). Подпись — HMAC по секрету сервера.
 * Токен хранится в localStorage клиента; сервер проверяет подпись при каждом запросе.
 */
export async function createAccessToken(userId: string, friendKey: string, secret: string, ttlMs = 7 * 24 * 3600_000): Promise<string> {
  const payload = { uid: userId, key: friendKey, exp: Date.now() + ttlMs };
  const body = btoa(JSON.stringify(payload)).replace(/=+$/, ''); // base64url-lite
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

/** Проверяет токен доступа; возвращает payload при валидности, иначе null. */
export async function verifyAccessToken(token: string, secret: string): Promise<{ uid: string; key: string; exp: number } | null> {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(secret, body);
  // Постоянное время сравнения не критично для демо, но сравниваем посимвольно длину/значение.
  if (sig.length !== expected.length || sig !== expected) return null;
  try {
    const payload = JSON.parse(atob(body));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    if (typeof payload.uid !== 'string' || typeof payload.key !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}
