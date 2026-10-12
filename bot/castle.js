/**
 * bot/castle.js — парсинг состояния и действия в панели Castle Host.
 *
 * Все «чувствительные к вёрстке» места собраны здесь + в selectors.js:
 * при редизайне панели правится только список вариантов селектора,
 * а не бизнес-логика. Пристук статуса/даты делается по тексту страницы,
 * поэтому не зависит от классов.
 */
import { log } from './logger.js';
import { humanDelay, humanClick, screenshot } from './browser.js';
import { ROUTES, SELECTORS, firstMatching } from './selectors.js';

const NAV_TIMEOUT = 45_000;

async function settle(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => {});
}

/** Переход на страницу конкретного сервера (по CASTLE_SERVER_ID). */
export async function openServerPage(page, cfg) {
  const direct = ROUTES.serverDetail(cfg.serverId);
  await page.goto(direct, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await settle(page);

  // Фолбэк: если прямой URL не существует (404/редирект) — идём через /servers
  // и кликаем по карточке с нашим ID (data-server-id или текст с ID).
  const broken = /404|not.?found/i.test((await page.title().catch(() => ''))) ||
    page.url() === ROUTES.servers;
  if (broken) {
    log.debug('Прямая ссылка на сервер не сработала — ищу карточку в списке');
    await page.goto(ROUTES.servers, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    const card =
      (await firstMatching(page, [`[data-server-id="${cfg.serverId}"]`, `[id*="${cfg.serverId}"]`])) ||
      (await firstMatching(page, [`a[href*="${cfg.serverId}"]`]));
    if (card) {
      await humanClick(card, cfg);
      await settle(page);
    }
  }
}

/**
 * Определяет статус сервера: online | offline | unknown.
 * Приоритет: data-атрибуты → явные маркеры → косвенные (наличие кнопки
 * «Включить» = offline, наличие «Выключить» = online).
 */
export async function getServerStatus(page, cfg) {
  await openServerPage(page, cfg);
  await humanDelay(cfg);

  const startBtn = await firstMatching(page, SELECTORS.startButton, { timeoutMs: 2500 });
  const stopBtn = await firstMatching(page, SELECTORS.stopButton, { timeoutMs: 1500 });

  if (startBtn && !stopBtn) return 'offline';
  if (stopBtn && !startBtn) return 'online';

  const online = await firstMatching(page, SELECTORS.statusOnline, { timeoutMs: 2000 });
  const offline = await firstMatching(page, SELECTORS.statusOffline, { timeoutMs: 2000 });
  if (online && !offline) return 'online';
  if (offline && !online) return 'offline';

  log.warn('Не удалось однозначно определить статус сервера');
  return 'unknown';
}

/** Эмулирует клик «Включить сервер». Возвращает true при успехе. */
export async function startServer(page, cfg) {
  await openServerPage(page, cfg);
  const btn = await firstMatching(page, SELECTORS.startButton, { timeoutMs: 8000 });
  if (!btn) {
    await screenshot(page, 'start-button-not-found');
    throw new Error('Кнопка «Включить» не найдена — обновите SELECTORS.startButton');
  }
  await humanDelay(cfg);
  await humanClick(btn, cfg);
  log.info('Клик «Включить сервер» выполнен, жду подтверждения статуса…');

  // Ждём перехода offline -> online (панель может boot'ить сервер до 2 минут).
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(5000);
    const st = await getServerStatus(page, cfg).catch(() => 'unknown');
    if (st === 'online') return true;
  }
  return false;
}

/**
 * Читает дату окончания аренды со страницы сервера/биллинга.
 * Ищет подписи «окончание/оплачен до/expire» рядом с датой dd.mm.yyyy
 * или yyyy-mm-dd. Возвращает Date или null.
 */
export async function getRentEndDate(page, cfg) {
  for (const url of [ROUTES.serverDetail(cfg.serverId), ROUTES.billing]) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await settle(page);
      const date = await page.evaluate(() => {
        const RX_LABEL = /(окончан|оплачен\w*\s*до|действует\s*до|expires?|end(?:ing)?|rent)/i;
        const RX_DATE = /(\d{4})-(\d{2})-(\d{2})|(\d{2})[./](\d{2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/;
        const nodes = Array.from(document.querySelectorAll('body *'));
        for (const el of nodes) {
          const own = Array.from(el.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent)
            .join(' ');
          const text = `${el.getAttribute('aria-label') || ''} ${own}`;
          if (!RX_LABEL.test(text)) continue;
          // Дата может быть в этом же тексте, в родителе или следующем соседе.
          const candidates = [text, el.parentElement?.textContent || '', el.nextElementSibling?.textContent || ''];
          for (const c of candidates) {
            const m = c.match(RX_DATE);
            if (!m) continue;
            const d = m[1]
              ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
              : new Date(Number(m[8]), Number(m[7]) - 1, Number(m[6]), Number(m[9] || 0), Number(m[10] || 0));
            if (!Number.isNaN(d.getTime())) return d.toISOString();
          }
        }
        return null;
      });
      if (date) return new Date(date);
    } catch (e) {
      log.debug(`Чтение даты аренды на ${url} не удалось: ${e.message}`);
    }
  }
  return null;
}

/**
 * Продление аренды на cfg.renewDays дней с оплатой с баланса аккаунта.
 * Кнопка → выбор периода (если есть select) → «оплатить с баланса» →
 * подтверждение (модалка) → проверка success-алерта.
 */
export async function renewServer(page, cfg) {
  await openServerPage(page, cfg);
  const renewBtn = await firstMatching(page, SELECTORS.renewButton, { timeoutMs: 8000 });
  if (!renewBtn) {
    await screenshot(page, 'renew-button-not-found');
    throw new Error('Кнопка «Продлить» не найдена — обновите SELECTORS.renewButton');
  }
  await humanDelay(cfg);
  await humanClick(renewBtn, cfg);
  await settle(page);

  // Если панель предлагает выбрать период — выбираем N дней.
  const periodSel = await firstMatching(page, SELECTORS.renewPeriod, { timeoutMs: 2500 });
  if (periodSel) {
    // Ищем option вида «7 дней» / «7 days» и выбираем его по значению.
    const wanted = `${cfg.renewDays}`;
    const optVal = await periodSel
      .locator(`option:has-text("${wanted}")`)
      .first()
      .getAttribute('value')
      .catch(() => null);
    if (optVal) {
      await periodSel.selectOption(optVal);
      log.debug(`Выбран период продления: ${wanted} дн`);
    }
    await humanDelay(cfg);
  }

  // Оплата с баланса аккаунта (без внешних платёжных систем).
  const balanceOpt = await firstMatching(page, SELECTORS.payFromBalance, { timeoutMs: 3000 });
  if (balanceOpt) {
    await humanClick(balanceOpt, cfg);
    await humanDelay(cfg);
  }

  const payBtn = await firstMatching(page, SELECTORS.confirmPayment, { timeoutMs: 6000 });
  if (!payBtn) {
    await screenshot(page, 'pay-button-not-found');
    throw new Error('Кнопка «Оплатить/Подтвердить» не найдена — обновите SELECTORS.confirmPayment');
  }
  await humanClick(payBtn, cfg);

  // Подтверждающая модалка, если всплывёт.
  const modal = await firstMatching(page, SELECTORS.modalConfirm, { timeoutMs: 4000 });
  if (modal) {
    await humanDelay(cfg);
    await humanClick(modal, cfg);
  }

  await page.waitForTimeout(4000);
  const ok = await firstMatching(page, SELECTORS.successAlerts, { timeoutMs: 8000 });
  if (ok) {
    log.info('Продление подтверждено панелью');
    return true;
  }
  await screenshot(page, 'renew-unverified');
  log.warn('Продление отправлено, но success-подтверждение не найдено — проверьте скриншот');
  return false;
}
