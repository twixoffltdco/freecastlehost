/**
 * bot/tasks2.js — бизнес-задачи ПРОДАКШЕН-режима (чистый HTTP, без эмуляции).
 *
 *  - dailyStart(api,cfg): окно 00:01 МСК — если сервер Offline → POST «Включить».
 *  - hourlyCheck(api,cfg): каждый час — статус + продление аренды при остатке
 *    < RENEW_THRESHOLD_HOURS (HTTP-эквивалент кликов «Продлить→Оплатить с баланса»).
 *  - withRetry(): повтор неудачного действия через RETRY_AFTER_MIN минут.
 *  - Если API-клиент не может выполнить действие (например, панель требует
 *    JS/капчу) — включается EMERGENCY FALLBACK: разовый запуск браузерного
 *    цикла (bot/castle.js), о чём приходит уведомление. Это страховка, а не
 *    основной путь: по умолчанию всё идёт через HTTP.
 */
import { log } from './logger.js';
import { notify } from './notify.js';
import { isStartWindowMoscow, formatMoscow } from './timezone.js';

/** Повторяет action через cfg.retryAfterMin минут, пока не вернёт true. */
export async function withRetry(cfg, taskName, action) {
  let lastErr = null;
  for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
    try {
      const ok = await action(attempt);
      if (ok) {
        log.info(`${taskName}: успех (попытка ${attempt})`);
        return true;
      }
      lastErr = new Error('панель не подтвердила выполнение');
    } catch (e) {
      lastErr = e;
      log.warn(`${taskName}: попытка ${attempt}/${cfg.maxRetries} не удалась: ${e.message}`);
    }
    if (attempt < cfg.maxRetries) {
      log.info(`Повтор «${taskName}» через ${cfg.retryAfterMin} мин…`);
      await new Promise((r) => setTimeout(r, cfg.retryAfterMin * 60_000));
    }
  }
  const msg = `${taskName}: ВСЕ ПОПЫТКИ ИСЧЕРПАНЫ. Причина: ${lastErr?.message ?? 'неизвестно'}`;
  log.error(msg);
  await notify(cfg, `❌ ${msg}\nВремя: ${formatMoscow()}`);
  return false;
}

/** Аварийный fallback через браузер (если HTTP-экшен недоступен). */
async function emergencyBrowserFallback(cfg, what) {
  if (!cfg.allowBrowserFallback) {
    await notify(cfg, `🛑 ${what} не выполнен через HTTP и fallback отключён (ALLOW_BROWSER_FALLBACK=false). Требуется вмешательство.`);
    return false;
  }
  log.warn(`HTTP-экшен «${what}» невозможен — запускаю аварийный браузерный fallback…`);
  await notify(cfg, `⚠️ ${what}: панель не даёт выполнить действие по HTTP, включаю резервный браузерный режим (разово).`);
  try {
    // Динамический импорт: playwright нужен только когда fallback реально сработал.
    const { openContext } = await import('./browser.js');
    const { login } = await import('./auth.js');
    const castle = await import('./castle.js');
    const context = await openContext(cfg);
    try {
      const page = await context.newPage();
      await login(page, cfg);
      let ok = false;
      if (what === 'Включение сервера') ok = await castle.startServer(page, cfg);
      else if (what === 'Продление аренды') ok = await castle.renewServer(page, cfg);
      await notify(cfg, ok ? `✅ ${what} выполнено через fallback` : `🛑 Fallback тоже не смог выполнить «${what}»`);
      return ok;
    } finally {
      await context.close().catch(() => {});
    }
  } catch (e) {
    log.error(`Браузерный fallback завершился ошибкой: ${e.message}`);
    return false;
  }
}

/** Ежедневное включение (00:01 МСК): offline → HTTP POST «Включить сервер». */
export async function dailyStart(api, cfg) {
  if (!isStartWindowMoscow()) {
    log.debug('Вне окна включения (00:01–00:59 МСК) — пропускаю');
    return;
  }
  log.info('Задача: ежедневное включение сервера (HTTP, без эмуляции)');
  const status = await api.getStatus();
  log.info(`Текущий статус сервера: ${status}`);
  if (status === 'online') {
    log.info('Сервер уже онлайн — ничего делать не нужно');
    return;
  }
  if (status === 'unknown') {
    await notify(cfg, '⚠️ Не удалось определить статус сервера по HTTP. Проверьте logs/bot.log и api-profile.json.');
    return;
  }
  const ok = await withRetry(cfg, 'Включение сервера', async () => {
    const started = await api.startServer();
    if (started) await notify(cfg, '✅ Сервер включён (00:01 МСК, штатный цикл, HTTP-режим)');
    return started;
  });
  if (!ok) {
    const fb = await emergencyBrowserFallback(cfg, 'Включение сервера');
    if (!fb) await notify(cfg, '🛑 Сервер остался OFFLINE после всех попыток включения!');
  }
}

/** Ежечасная проверка: статус + продление аренды при < порога часов. */
export async function hourlyCheck(api, cfg) {
  log.info('Задача: часовая проверка статуса и аренды (HTTP, без эмуляции)');

  // 1) Страховочное включение в ночном окне.
  const status = await api.getStatus();
  log.info(`Статус сервера: ${status}`);
  if (isStartWindowMoscow() && status === 'offline') {
    const ok = await withRetry(cfg, 'Включение сервера (часовой чек)', async () => {
      const started = await api.startServer();
      if (started) await notify(cfg, '✅ Сервер включён (страховочная проверка, HTTP)');
      return started;
    });
    if (!ok) await emergencyBrowserFallback(cfg, 'Включение сервера');
  } else if (status === 'offline' && !isStartWindowMoscow()) {
    await notify(cfg, `⚠️ Сервер OFFLINE вне планового окна (${formatMoscow()}). Требуется внимание.`);
  }

  // 2) Аренда: осталось < порога часов → продление с оплатой с баланса.
  const endDate = await api.getRentEndDate();
  if (!endDate) {
    log.warn('Дата окончания аренды не найдена по HTTP — проверьте блок expiresSelector в api-profile.json');
    return;
  }
  const hoursLeft = (endDate.getTime() - Date.now()) / 3_600_000;
  log.info(`До окончания аренды: ${hoursLeft.toFixed(1)} ч (порог ${cfg.renewThresholdHours} ч)`);
  if (hoursLeft > cfg.renewThresholdHours) return;

  const ok = await withRetry(cfg, `Продление аренды на ${cfg.renewDays} дней`, async () => {
    const renewed = await api.renewAndPay();
    if (renewed) {
      await notify(
        cfg,
        `💳 Аренда продлена на ${cfg.renewDays} дней (оплата с баланса, HTTP-режим).\n` +
          `Оставалось ${Math.max(0, hoursLeft).toFixed(1)} ч. Время: ${formatMoscow()}`,
      );
    }
    return renewed;
  });
  if (!ok) {
    const fb = await emergencyBrowserFallback(cfg, 'Продление аренды');
    if (!fb) await notify(cfg, '🛑 Продление аренды НЕ выполнено! Сервер может быть удалён хостингом.');
  }
}
