/**
 * bot/notify.js — уведомления владельца: Telegram (Bot API) и простой webhook.
 * Уведомления содержат только статусы действий (включение/продление/ошибки),
 * никогда — пароли или cookies.
 */
import { log } from './logger.js';

async function postJson(url, body, timeoutMs = 10_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Отправляет текстовое уведомление во все настроенные каналы.
 * Ошибки доставки не должны ронять бота — только log.warn.
 */
export async function notify(cfg, text) {
  log.info(`Уведомление: ${text}`);

  if (cfg.telegramToken && cfg.telegramChatId) {
    try {
      const res = await postJson(
        `https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`,
        { chat_id: cfg.telegramChatId, text: `🎮 bothostgtagame\n${text}` },
      );
      if (!res.ok) log.warn(`Telegram API ответил ${res.status}`);
    } catch (e) {
      log.warn(`Не удалось отправить в Telegram: ${e.message}`);
    }
  }

  if (cfg.webhookUrl) {
    try {
      const res = await postJson(cfg.webhookUrl, { text });
      if (!res.ok) log.warn(`Webhook ответил ${res.status}`);
    } catch (e) {
      log.warn(`Не удалось отправить webhook: ${e.message}`);
    }
  }
}
