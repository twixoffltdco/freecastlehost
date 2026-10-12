/**
 * lib/hostgta.ts — низкоуровневый HTTP-клиент для HostGta.ru.
 *
 * ПРОДАКШЕН-РЕЖИМ: user = agent. Это НЕ эмуляция браузера — здесь нет
 * ни headless-Chrome, ни исполнения JS. Только прямые HTTP-запросы
 * (fetch + разбор JSON/HTML) от имени единого аккаунта-агента HostGta.
 * Вся логика сессии агента (cookie-jar, CSRF, авторизация) — в lib/agent.ts,
 * а этот модуль предоставляет маршруты и чистящие хелперы поверх него.
 *
 * Если HostGta за Cloudflare и простые запросы получают 403 — используйте
 * готовую сессионную cookie (AGENT_SESSION_COOKIE) или резидентный прокси
 * (AGENT_PROXY_URL). См. docs/deployment.md → «Обход Cloudflare».
 *
 * ПРИМЕЧАНИЕ ДЛЯ ФОРКА: конкретные URL эндпоинтов и CSS-селекторы HostGta могут
 * меняться. Все «чувствительные к сайту» константы вынесены в HOSTGTA_ROUTES,
 * чтобы их было легко обновить в одном месте.
 */

import * as cheerio from 'cheerio';
import { getEnv } from './env';
import { getAgent } from './agent';
import type { ServerStatus } from './types';

const DEFAULT_UA = 'bothostgtagame/1.0 (production agent client; +https://github.com/bothostgtagame)';

/** Селекторы и маршруты HostGta — единая точка правки при редизайне сайта. */
export const HOSTGTA_ROUTES = {
  login: '/auth/login',
  friends: '/friends', // страница заявок/друзей аккаунта агента
  friendRequests: '/api/friends/requests', // JSON-эндпоинт входящих заявок
  friendAccept: '/api/friends/accept', // принять заявку (v1.1)
  /** Статус конкретного сервера агента/пользователя (JSON или HTML). */
  serverStatus: (serverId: string) => `/api/servers/${encodeURIComponent(serverId)}/status`,
  /** Команда включения сервера — аналог POST кнопки «Включить» в панели. */
  serverStart: (serverId: string) => `/api/servers/${encodeURIComponent(serverId)}/start`,
  servers: '/servers', // панель серверов пользователя
} as const;

export interface HttpOptions {
  method?: 'GET' | 'POST';
  body?: URLSearchParams | string;
  headers?: Record<string, string>;
  /** Следовать ли редиректам (для POST-эмуляции кнопки лучше false). */
  redirect?: RequestRedirect;
}

/**
 * Хранилище cookies бота в памяти процесса.
 * Заполняется после логина либо из AGENT_SESSION_COOKIE.
 */
let cookieJar = '';

/** Инициализирует куки сессии агента из env (предпочтительный способ авторизации). */
export function initSessionFromEnv(): void {
  const env = getEnv();
  if (env.sessionCookie && !cookieJar) {
    // Формат куки может отличаться — подстройте значение под реальный cookie HostGta.
    cookieJar = env.sessionCookie;
  }
}

/** Разбирает Set-Cookie из ответа и обновляет jar. */
function absorbCookies(response: Response): void {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const pair = c.split(';')[0];
    if (!pair.includes('=')) continue;
    const [name] = pair.split('=');
    // Простой merge: заменяем значение одноимённой куки.
    const entries = new Map(cookieJar.split('; ').filter(Boolean).map((p) => [p.split('=')[0], p]));
    entries.set(name.trim(), pair.trim());
    cookieJar = Array.from(entries.values()).join('; ');
  }
}

/** Выполняет HTTP-запрос к HostGta с авторизацией бота. */
export async function hostgtaFetch(path: string, opts: HttpOptions = {}): Promise<Response> {
  const env = getEnv();
  initSessionFromEnv();

  const url = path.startsWith('http') ? path : `${env.baseUrl}${path}`;
  const headers: Record<string, string> = {
    'User-Agent': env.userAgent || DEFAULT_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    Referer: `${env.baseUrl}/`,
    ...opts.headers,
  };
  if (cookieJar) headers.Cookie = cookieJar;

  const response = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body,
    redirect: opts.redirect ?? 'follow',
    cache: 'no-store',
  });

  absorbCookies(response);
  return response;
}

/**
 * Логин агента по login/паролю (fallback-вариант, если нет AGENT_SESSION_COOKIE).
 * Возвращает true при успехе. При включённой капче метод не сработает —
 * используйте готовую сессионную cookie или резидентный прокси.
 */
export async function loginBot(): Promise<boolean> {
  const env = getEnv();
  if (!env.agentLogin || !env.agentPassword) return false;

  const form = new URLSearchParams({ email: env.agentLogin, password: env.agentPassword });
  const res = await hostgtaFetch(HOSTGTA_ROUTES.login, {
    method: 'POST',
    body: form.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  });
  // Успешный логин обычно = 302 на главную + выставленная сессионная кука.
  return res.status >= 200 && res.status < 400;
}

/**
 * Проверяет, есть ли userKey среди входящих заявок в друзья агента.
 * ПРОДАКШЕН (user=agent): сначала быстрый JSON-API через AgentSession;
 * если API не отдал совпадений — фолбэк-парсинг HTML-страницы /friends
 * через Cheerio (тоже без эмуляции браузера, обычный HTTP-ответ).
 */
export async function findFriendKey(userKey: string): Promise<{ found: boolean; userId?: string }> {
  const safeKey = sanitizeKey(userKey);
  if (!safeKey) return { found: false };

  // 1. Основной путь — прямой запрос к API заявок от имени агента.
  const agent = getAgent();
  const apiResult = await agent.verifyFriendKey(safeKey);
  if (apiResult.ok && apiResult.userId) {
    return { found: true, userId: apiResult.userId };
  }

  // 2. Фолбэк — парсинг HTML-страницы друзей (если у HostGta нет JSON-API).
  const res = await hostgtaFetch(HOSTGTA_ROUTES.friends);
  if (!res.ok) return { found: false };

  const html = await res.text();
  const $ = cheerio.load(html);

  // Ищем элемент, содержащий наш ключ (заявки в друзья обычно лежат в .friend-request и т.п.)
  let userId: string | undefined;
  $('[data-user-id], .friend-request, li.friend, tr.request').each((_i, el) => {
    if (userId) return;
    const text = $(el).text();
    if (text.toLowerCase().includes(safeKey)) {
      userId = $(el).attr('data-user-id') ?? $(el).find('[data-user-id]').first().attr('data-user-id') ?? safeKey.slice(0, 8);
    }
  });

  return userId ? { found: true, userId } : { found: false };
}

/**
 * Получает статус сервера пользователя (hostgta.ru/servers/<id>).
 * Чистый HTTP GET от имени агента: JSON-API или разбор HTML-бейджа статуса.
 * serverId = 'default' — первый/основной сервер аккаунта (MVP-допущение).
 */
export async function getServerStatus(serverId = 'default'): Promise<ServerStatus> {
  const snapshot = await getAgent().getServerStatus(serverId);
  if (snapshot.status !== 'unknown') return snapshot.status;

  // Фолбэк: страница панели серверов целиком (смена формата API → парсим HTML).
  const res = await hostgtaFetch(HOSTGTA_ROUTES.servers);
  if (!res.ok) return 'unknown';
  const html = await res.text();
  const $ = cheerio.load(html);

  const statusText = $('.server-status, .status-badge, [data-status]').first().text().toLowerCase();
  if (/online|включ|активн/.test(statusText)) return 'online';
  if (/offline|выключ|остановл|stopped/.test(statusText)) return 'offline';

  // Fallback: грубый поиск по всей странице.
  const body = $('body').text().toLowerCase();
  if (body.includes('сервер запущен') || body.includes('online')) return 'online';
  if (body.includes('сервер выключен') || body.includes('offline')) return 'offline';
  return 'unknown';
}

/**
 * Автоматическое включение сервера — production POST-запрос кнопки «Включить»
 * напрямую на эндпоинт управления от имени агента (без эмуляции браузера).
 */
export async function startServer(serverId = 'default'): Promise<boolean> {
  return getAgent().startServer(serverId);
}

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------

/** Жёсткая санитизация пользовательского ключа: только hex/alnum, длина ≤ 64. */
export function sanitizeKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase();
  return /^[a-z0-9]{6,64}$/.test(cleaned) ? cleaned : null;
}

/** Определяет, что вместо нужной страницы мы получили форму логина. */
async function looksLikeLoginPage(res: Response): Promise<boolean> {
  try {
    const cloned = res.clone();
    const html = await cloned.text();
    return html.includes('name="password"') || html.toLowerCase().includes('/auth/login');
  } catch {
    return false;
  }
}
