/**
 * lib/env.ts — единая точка чтения конфигурации из переменных окружения.
 * Все секреты агента живут ТОЛЬКО на сервере (в env), никогда не попадают в браузер.
 *
 * ПРОДАКШЕН-РЕЖИМ: user = agent. Один аккаунт-агент HostGta обслуживает всех
 * пользователей инструмента. Эмуляция браузера не используется — только HTTP.
 */

export interface EnvConfig {
  /** Логин/e-mail агента (учётная запись бота на HostGta). */
  agentLogin: string;
  /** Пароль агента (нужен только если нет готовой AGENT_SESSION_COOKIE). */
  agentPassword: string;
  /** Готовая сессионная cookie агента — предпочтительный способ авторизации. */
  sessionCookie: string;
  baseUrl: string;
  /** Необязательный прокси для HTTP-запросов агента (обход rate-limit/CF по IP). */
  proxyUrl: string;
  userAgent: string;
  monitorIntervalMin: number;
  cronSecret: string;
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

/** Читает конфигурацию из process.env (вызывать только в Server Components / Route Handlers). */
export function getEnv(): EnvConfig {
  return {
    agentLogin: process.env.AGENT_LOGIN ?? '',
    agentPassword: process.env.AGENT_PASSWORD ?? '',
    sessionCookie: process.env.AGENT_SESSION_COOKIE ?? '',
    baseUrl: (process.env.HOSTGTA_BASE_URL ?? 'https://hostgta.ru').replace(/\/+$/, ''),
    proxyUrl: process.env.AGENT_PROXY_URL ?? '',
    userAgent:
      process.env.AGENT_USER_AGENT ??
      'bothostgtagame/1.0 (production agent client; +https://github.com/bothostgtagame)',
    monitorIntervalMin: Number(process.env.MONITOR_INTERVAL_MIN ?? 60),
    cronSecret: process.env.CRON_SECRET ?? '',
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 20),
  };
}

/** Проверка, что сервер настроен для работы с HostGta (иначе API вернёт понятную ошибку). */
export function isHostgtaConfigured(env: EnvConfig = getEnv()): boolean {
  return Boolean(env.sessionCookie || (env.agentLogin && env.agentPassword));
}
