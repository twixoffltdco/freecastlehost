/**
 * bot/config.js — единая точка чтения конфигурации.
 *
 * БЕЗОПАСНОСТЬ: все учётные данные берутся ТОЛЬКО из .env.local (dotenv).
 * Пароли никогда не хардкодятся, не пишутся в логи и не хранятся в браузере.
 */
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

// .env.local имеет приоритет над .env; шаблон .env.example секретов не содержит.
dotenv.config({ path: '.env.local' });
dotenv.config(); // запасной вариант — обычный .env

const bool = (v, d = false) =>
  v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v));
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export function loadConfig() {
  // Точное время по МСК независимо от TZ сервера (см. bot/timezone.js).
  process.env.TZ = process.env.TZ || 'Europe/Moscow';

  const cfg = {
    login: process.env.CASTLE_LOGIN || '',
    password: process.env.CASTLE_PASSWORD || '',
    serverId: process.env.CASTLE_SERVER_ID || '',
    baseUrl: (process.env.CASTLE_BASE_URL || 'https://cp.castle-host.com').replace(/\/+$/, ''),

    headless: bool(process.env.HEADLESS, true),
    chromePath: process.env.CHROME_PATH || '',
    sessionDir: path.resolve(process.env.SESSION_DIR || './session'),

    // ПРОДАКШЕН (HTTP без эмуляции): ключ шифрования сохранённой сессии
    // и разрешение аварийного браузерного fallback.
    sessionSecret: process.env.SESSION_SECRET || '',
    apiProfile: process.env.API_PROFILE || './api-profile.json',
    allowBrowserFallback: bool(process.env.ALLOW_BROWSER_FALLBACK, true),

    startCron: process.env.START_CRON || '1 0 * * *', // 00:01 МСК ежедневно
    checkCron: process.env.CHECK_CRON || '5 * * * *', // каждый час
    renewThresholdHours: num(process.env.RENEW_THRESHOLD_HOURS, 24),
    renewDays: num(process.env.RENEW_DAYS, 7),

    humanDelayMinMs: num(process.env.HUMAN_DELAY_MIN_MS, 800),
    humanDelayMaxMs: num(process.env.HUMAN_DELAY_MAX_MS, 3500),
    retryAfterMin: num(process.env.RETRY_AFTER_MIN, 5),
    maxRetries: num(process.env.MAX_RETRIES, 3),

    logLevel: process.env.LOG_LEVEL || 'info',
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    webhookUrl: process.env.WEBHOOK_URL || '',
    captchaKey: process.env.CAPTCHA_23_CAPTCHA_KEY || '',
  };

  const problems = [];
  if (!cfg.login) problems.push('CASTLE_LOGIN');
  if (!cfg.password) problems.push('CASTLE_PASSWORD');
  if (!cfg.serverId) problems.push('CASTLE_SERVER_ID');
  if (!cfg.sessionSecret && !process.env.CI_ALLOW_NO_SESSION_SECRET) {
    throw new Error(
      'Не задан SESSION_SECRET — ключ шифрования сохранённой HTTP-сессии. ' +
        'Сгенерируйте: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" и добавьте в .env.local.',
    );
  }
  if (problems.length) {
    throw new Error(
      `Не заданы обязательные переменные: ${problems.join(', ')}. ` +
        'Создайте .env.local по шаблону .env.example (и НЕ коммитьте его в Git).',
    );
  }
  return cfg;
}
