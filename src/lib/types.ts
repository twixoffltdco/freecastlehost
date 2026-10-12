/**
 * lib/types.ts — общие TypeScript-типы проекта bothostgtagame.
 */

/** Статус игрового сервера, распознанный со страницы hostgta.ru/servers. */
export type ServerStatus = 'online' | 'offline' | 'maintenance' | 'unknown';

/** Результат проверки статуса сервера (возвращается /api/check-server-status). */
export interface ServerStatusResult {
  status: ServerStatus;
  /** Был ли выполнен автоматический рестарт (POST «включить») на этом цикле. */
  autoRestarted: boolean;
  /** ISO-время последней проверки. */
  checkedAt: string;
  /** Непрерывный uptime с момента последнего подтверждённого включения (мс), если известен. */
  uptimeMs: number | null;
  /** Краткое сообщение для UI. */
  message?: string;
}

/** Результат верификации Friend Key (возвращается /api/verify-friend). */
export interface VerifyFriendResult {
  /** Найден ли ключ среди заявок/друзей бота. */
  found: boolean;
  /** ID пользователя HostGta, привязанный к ключу (при успехе). */
  userId?: string;
  /** Токен доступа к дашборду (при успехе). */
  accessToken?: string;
  /** Человекочитаемое сообщение (ошибка/пояснение). */
  message?: string;
}

/** Запись в журнале мониторинга (для истории в дашборде). */
export interface MonitorLogEntry {
  at: string;
  status: ServerStatus;
  autoRestarted: boolean;
}
