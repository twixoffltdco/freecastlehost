/**
 * bot/index.js — точка входа ПРОДАКШЕН v3: чистый HTTP, без эмуляции браузера.
 *
 * Планировщик (node-cron, TZ=Europe/Moscow):
 *   - START_CRON (по умолчанию «1 0 * * *») — ежедневное включение сервера в 00:01 МСК;
 *   - CHECK_CRON (по умолчанию «5 * * * *») — почасовая проверка статуса и продления аренды.
 *
 * Все операции выполняет bot/api.js (fetch + cookie-jar). Браузер не запускается;
 * Playwright остаётся только как аварийный fallback (см. ALLOW_BROWSER_FALLBACK).
 * Секреты — только из .env.local. Запуск: `npm start`.
 */
import process from 'node:process';
import cron from 'node-cron';
import { loadConfig } from './config.js';
import { initLogger, log } from './logger.js';
import { notify } from './notify.js';
import { ApiClient } from './api.js';
import { dailyStart, hourlyCheck } from './tasks2.js';

const cfg = loadConfig();
initLogger({ logLevel: cfg.logLevel });

if (!cron.validate(cfg.startCron)) throw new Error(`Некорректный START_CRON: "${cfg.startCron}"`);
if (!cron.validate(cfg.checkCron)) throw new Error(`Некорректный CHECK_CRON: "${cfg.checkCron}"`);

const api = new ApiClient(cfg, log);
let busy = false; // одна бизнес-сессия одновременно

async function runTask(name, fn) {
  if (busy) {
    log.warn(`${name}: предыдущая задача ещё выполняется — пропускаю запуск`);
    return;
  }
  busy = true;
  try {
    await fn(api, cfg);
  } catch (e) {
    log.error(`${name}: сбой цикла — ${e.message}`);
    await notify(cfg, `⚠️ ${name}: ${e.message}`);
  } finally {
    busy = false;
  }
}

log.info('bothostgtagame v3 PRODUCTION (Castle Host, HTTP без эмуляции) запущен', {
  baseUrl: cfg.baseUrl,
  serverId: cfg.serverId,
  startCron: cfg.startCron,
  checkCron: cfg.checkCron,
  browserFallback: cfg.allowBrowserFallback,
});

// Предварительная подготовка: профиль эндпоинтов + живая сессия (или вход).
// Ошибки не валят демона — задачи повторят попытку по своим retry-циклам.
await api.ensureLogin().catch(async (e) => {
  log.error(`Стартовый вход не удался: ${e.message}`);
  await notify(cfg, `⚠️ Бот стартовал без сессии: ${e.message}. Повторю при первой задаче.`);
});

// node-cron использует TZ процесса (Europe/Moscow выставлен в config.js).
cron.schedule(cfg.startCron, () => runTask('Ежедневное включение', dailyStart), { name: 'daily-start' });
cron.schedule(cfg.checkCron, () => runTask('Часовая проверка', hourlyCheck), { name: 'hourly-check' });

// Страховка: через минуту после старта делаем один чек — чтобы убедиться,
// что вход и парсинг работают, не дожидаясь часа X.
setTimeout(() => runTask('Первичная проверка', hourlyCheck), 60_000);

function shutdown(signal) {
  log.info(`Получен ${signal}, останавливаюсь…`);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (r) => log.error('Unhandled rejection', { reason: String(r) }));
