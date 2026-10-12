/**
 * bot/auth-once.js — подготовка HTTP-сессии для ПРОДАКШЕН-режима.
 *
 * 1. `npm run discover` — изучает панель по HTTP и создаёт api-profile.json
 *    (эндпоинты входа, страницы сервера, кнопок «Включить/Продлить/Оплатить»).
 * 2. `npm run auth` — выполняет вход формой из профиля и сохраняет cookies
 *    в зашифрованный session/session.json (ключ SESSION_SECRET).
 *
 * Если панель принципиально не даёт войти по HTTP (например, обязательная
 * интерактивная капча), используйте резервный путь: HEADLESS=false npm run login:once
 * (браузерный профиль) — но по умолчанию продакшен работает без эмуляции.
 */
import process from 'node:process';
import { loadConfig } from './config.js';
import { initLogger, log } from './logger.js';
import { ApiClient } from './api.js';

const cfg = loadConfig();
initLogger({ logLevel: cfg.logLevel });

const api = new ApiClient(cfg, log);
const mode = process.argv[2] || 'auth';

try {
  if (mode === 'discover') {
    await api.discover();
  } else {
    await api.ensureLogin();
    const ok = await api.checkAuth();
    log.info(ok ? 'Сессия активна и сохранена (session/session.json, AES-256-GCM)' : 'Вход выполнен, но проверка /servers не подтвердилась — выполните `npm run discover`');
  }
} catch (e) {
  log.error(`Не удалось: ${e.message}`);
  process.exitCode = 1;
}
