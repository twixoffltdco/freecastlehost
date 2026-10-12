/**
 * bot/login-once.js — интерактивный одноразовый вход.
 *
 * Назначение: один раз залогиниться в видимом окне браузера и (при
 * необходимости) вручную пройти капчу/2FA. Сессия сохранится в persistent-
 * профиль SESSION_DIR, дальше планировщик работает headless без пароля.
 *
 * Запуск: HEADLESS=false npm run login:once
 */
import process from 'node:process';
import { loadConfig } from './config.js';
import { initLogger, log } from './logger.js';
import { openContext } from './browser.js';
import { login } from './auth.js';

const cfg = { ...loadConfig(), headless: false }; // всегда показываем окно
initLogger({ logLevel: 'debug' });

const context = await openContext(cfg);
const page = await context.newPage();
try {
  await login(page, cfg);
  log.info('Готово! Сессия сохранена в профиле — закрываю браузер через 10 секунд.');
  await page.waitForTimeout(10_000);
} catch (e) {
  log.error(`Вход не выполнен: ${e.message}`);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
}
