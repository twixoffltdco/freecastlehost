/**
 * lib/monitor.ts — бизнес-логика мониторинга сервера 24/7 (MVP).
 *
 * Вызывается из:
 *  - /api/check-server-status (проверка «по требованию» из дашборда);
 *  - /api/cron/monitor (фоновый цикл каждые N минут через Vercel Cron / системный cron).
 *
 * Логика: GET статуса -> если Offline -> POST «включить» -> повторная проверка.
 * ПРОДАКШЕН (user = agent): все запросы идут от имени аккаунта-агента HostGta
 * через AgentSession (lib/agent.ts) — чистый HTTP, без эмуляции браузера.
 */

import { getEnv, isHostgtaConfigured } from './env';
import * as hostgta from './hostgta';
import type { ServerStatus, ServerStatusResult } from './types';

/**
 * Определяет статус сервера и при необходимости запускает его.
 * @param serverId ID сервера на HostGta ('default' — основной сервер аккаунта).
 */
export async function checkServerStatus(serverId = 'default'): Promise<ServerStatusResult> {
  const env = getEnv();
  const checkedAt = new Date().toISOString();

  if (!isHostgtaConfigured(env)) {
    return {
      status: 'unknown',
      autoRestarted: false,
      checkedAt,
      uptimeMs: null,
      message: 'Сервер не настроен: заполните AGENT_SESSION_COOKIE или AGENT_LOGIN/AGENT_PASSWORD в .env.local',
    };
  }

  let status: ServerStatus = 'unknown';
  let autoRestarted = false;

  try {
    status = await hostgta.getServerStatus(serverId);
    if (status === 'offline') {
      // Автозапуск: production POST кнопки «Включить» от имени агента.
      autoRestarted = await hostgta.startServer(serverId);
      // Даём панели несколько секунд и проверяем повторно.
      await new Promise((r) => setTimeout(r, 8000));
      status = await hostgta.getServerStatus(serverId);
    }
  } catch (err) {
    console.error('[monitor] ошибка проверки статуса:', err);
    return {
      status: 'unknown',
      autoRestarted: false,
      checkedAt,
      uptimeMs: null,
      message: 'Не удалось связаться с HostGta (Cloudflare? смена API?). Проверьте AGENT_SESSION_COOKIE и AGENT_PROXY_URL.',
    };
  }

  // Обновляем «момент последней остановки» для расчёта uptime.
  if (status === 'offline') lastKnownStop = Date.now();
  const uptimeMs = status === 'online' && lastKnownStop !== null ? Date.now() - lastKnownStop : null;

  return {
    status,
    autoRestarted,
    checkedAt,
    uptimeMs,
    message: autoRestarted ? 'Сервер был выключен — выполнен автоматический запуск.' : undefined,
  };
}

/** Момент последней фиксации Offline (в памяти процесса; для расчёта uptime). */
let lastKnownStop: number | null = null;
