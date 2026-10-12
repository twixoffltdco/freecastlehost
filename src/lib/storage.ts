/**
 * lib/storage.ts — обёртка над localStorage для клиентского состояния.
 * Здесь хранятся: сгенерированный Friend Key, верифицированный ID пользователя,
 * токен доступа к дашборду и последний известный статус сервера.
 *
 * ВАЖНО (см. README): при очистке кеша браузера управление теряется —
 * пользователь должен заново пройти верификацию. Фоновый мониторинг
 * через cron-эндпоинт (/api/cron/monitor) при этом НЕ останавливается.
 */

const KEYS = {
  friendKey: 'bothostgtga:friend-key',
  userId: 'bothostgtga:user-id',
  accessToken: 'bothostgtga:access-token',
  lastStatus: 'bothostgtga:last-status',
} as const;

/** Безопасная проверка доступности localStorage (SSR-совместимость). */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

export function saveFriendKey(key: string): void {
  if (isBrowser()) localStorage.setItem(KEYS.friendKey, key);
}

export function getFriendKey(): string | null {
  return isBrowser() ? localStorage.getItem(KEYS.friendKey) : null;
}

export function saveVerifiedUser(userId: string, accessToken: string): void {
  if (!isBrowser()) return;
  localStorage.setItem(KEYS.userId, userId);
  localStorage.setItem(KEYS.accessToken, accessToken);
}

export function getUserId(): string | null {
  return isBrowser() ? localStorage.getItem(KEYS.userId) : null;
}

export function getAccessToken(): string | null {
  return isBrowser() ? localStorage.getItem(KEYS.accessToken) : null;
}

export function saveLastStatus(status: unknown): void {
  if (isBrowser()) localStorage.setItem(KEYS.lastStatus, JSON.stringify(status));
}

export function getLastStatus<T = unknown>(): T | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(KEYS.lastStatus);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Полный сброс локального состояния (кнопка «Выйти» в дашборде). */
export function clearAll(): void {
  if (!isBrowser()) return;
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
}
