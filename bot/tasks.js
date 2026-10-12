/**
 * bot/tasks.js — бизнес-задачи планировщика с retry-логикой.
 *
 *  - dailyStart(): окно 00:01 МСК — если сервер Offline, кликнуть «Включить».
 *  - hourlyCheck(): каждый час — статус + проверка окончания аренды
 *    (< RENEW_THRESHOLD_HOURS → «Продлить на N дней» с оплатой с баланса).
 *  - withRetry(): неудачное действие повторяется через RETRY_AFTER_MIN минут
 *    до MAX_RETRIES раз; финальный фейл уходит в лог и Telegram/webhook.
 */
import { log } from './logger.js';
import { notify } from './notify.js';
import { isStartWindowMoscow, formatMoscow } from './timezone.js';
import { getServerStatus, startServer, renewServer, getRentEndDate } from './castle.js';

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
      const waitMs = cfg.retryAfterMin * 60_000;
      log.info(`Повтор «${taskName}» через ${cfg.retryAfterMin} мин…`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  const msg = `${taskName}: ВСЕ ПОПЫТКИ ИСЧЕРПАНЫ. Причина: ${lastErr?.message ?? 'неизвестно'}`;
  log.error(msg);
  await notify(cfg, `❌ ${msg}\nВремя: ${formatMoscow()}`);
  return false;
}

/** Ежедневное включение (00:01 МСК): offline → клик «Включить сервер». */
export async function dailyStart(getPage, releasePage, cfg) {
  if (!isStartWindowMoscow()) {
    log.debug('Вне окна включения (00:01–00:59 МСК) — пропускаю');
    return;
  }
  log.info('Задача: ежедневное включение сервера');
  const page = await getPage();
  try {
    const status = await getServerStatus(page, cfg);
    log.info(`Текущий статус сервера: ${status}`);
    if (status === 'online') {
      log.info('Сервер уже онлайн — ничего делать не нужно');
      return;
    }
    if (status === 'unknown') {
      await notify(cfg, '⚠️ Не удалось определить статус сервера. Проверьте logs/ и screenshots/.');
      return;
    }
    const ok = await withRetry(cfg, 'Включение сервера', async () => {
      const started = await startServer(page, cfg);
      if (started) await notify(cfg, `✅ Сервер включён (00:01 МСК, штатный цикл)`);
      return started;
    });
    if (!ok) await notify(cfg, '🛑 Сервер остался OFFLINE после всех попыток включения!');
  } finally {
    await releasePage();
  }
}

/** Ежечасная проверка: статус + продление аренды при <24ч до окончания. */
export async function hourlyCheck(getPage, releasePage, cfg) {
  log.info('Задача: часовая проверка статуса и аренды');
  const page = await getPage();
  try {
    // 1) Страховочное включение: если мы в ночном окне и сервер упал — поднимаем.
    const status = await getServerStatus(page, cfg);
    log.info(`Статус сервера: ${status}`);
    if (isStartWindowMoscow() && status === 'offline') {
      await withRetry(cfg, 'Включение сервера (часовой чек)', async () => {
        const started = await startServer(page, cfg);
        if (started) await notify(cfg, '✅ Сервер включён (страховочная проверка)');
        return started;
      });
    } else if (status === 'offline' && !isStartWindowMoscow()) {
      await notify(cfg, `⚠️ Сервер OFFLINE вне планового окна (${formatMoscow()}). Требуется внимание.`);
    }

    // 2) Аренда: осталось < порога часов → продлеваем и оплачиваем с баланса.
    const endDate = await getRentEndDate(page, cfg);
    if (!endDate) {
      log.warn('Дата окончания аренды не найдена на странице — пропускаю проверку продления');
      return;
    }
    const hoursLeft = (endDate.getTime() - Date.now()) / 3_600_000;
    log.info(`До окончания аренды: ${hoursLeft.toFixed(1)} ч (порог ${cfg.renewThresholdHours} ч)`);
    if (hoursLeft > cfg.renewThresholdHours) return;

    const ok = await withRetry(cfg, `Продление аренды на ${cfg.renewDays} дней`, async () => {
      const renewed = await renewServer(page, cfg);
      if (renewed) {
        await notify(
          cfg,
          `💳 Аренда продлена на ${cfg.renewDays} дней (оплата с баланса).\n` +
            `Оставалось ${Math.max(0, hoursLeft).toFixed(1)} ч. Время: ${formatMoscow()}`,
        );
      }
      return renewed;
    });
    if (!ok) await notify(cfg, '🛑 Продление аренды НЕ выполнено! Сервер может быть удалён хостингом.');
  } finally {
    await releasePage();
  }
}
