/**
 * bot/check-once.js — разовый полный цикл проверки ПРОДАКШЕН-режима
 * (для отладки и системного crontab). Статус + возможное включение/продление
 * выполняются по HTTP, без запуска браузера.
 * Запуск: npm run check:once
 */
import process from 'node:process';
import { loadConfig } from './config.js';
import { initLogger, log } from './logger.js';
import { ApiClient } from './api.js';
import { hourlyCheck } from './tasks2.js';

const cfg = loadConfig();
initLogger({ logLevel: cfg.logLevel });

const api = new ApiClient(cfg, log);
try {
  await api.ensureLogin();
  await hourlyCheck(api, cfg);
} catch (e) {
  log.error(`Цикл проверки завершился с ошибкой: ${e.message}`);
  process.exitCode = 1;
}
