/**
 * bot/browser.js — запуск браузера Playwright + human-like действия.
 *
 * playwright-core не скачивает свой браузер: используется системный
 * Chrome/Chromium (см. README → «Установка браузера») или CHROME_PATH из env.
 * Сессия хранится в persistent-контексте (SESSION_DIR, вне Git): cookies
 * живут в профиле браузера, а НЕ в localStorage страницы и НЕ с паролем.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { log } from './logger.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** Платформенные кандидаты исполняемого файла Chrome. */
const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findChrome(explicit) {
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error(
    'Не найден Chrome/Chromium. Установите браузер (см. README) ' +
      'или укажите путь в CHROME_PATH в .env.local.',
  );
}

/** Открывает persistent-контекст: повторные запуски стартуют уже залогиненными. */
export async function openContext(cfg) {
  fs.mkdirSync(cfg.sessionDir, { recursive: true });
  const context = await chromium.launchPersistentContext(cfg.sessionDir, {
    headless: cfg.headless,
    executablePath: findChrome(cfg.chromePath),
    userAgent: UA,
    viewport: { width: 1366, height: 850 },
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    args: [
      '--disable-blink-features=AutomationControlled', // скрываем flag автоматизации
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  log.debug('Браузер запущен', { headless: cfg.headless });
  return context;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Случайная пауза между действиями — имитация живого человека (антибан). */
export async function humanDelay(cfg) {
  const min = cfg.humanDelayMinMs;
  const max = Math.max(min, cfg.humanDelayMaxMs);
  const ms = Math.round(min + Math.random() * (max - min));
  log.debug(`Пауза ${ms} мс`);
  await sleep(ms);
}

/** «Человеческий» ввод: посимвольно, со случайными интервалами. */
export async function humanType(locator, text, cfg) {
  await locator.click();
  await sleep(150 + Math.random() * 250);
  for (const ch of text) {
    await locator.pressSequentially(ch, { delay: 40 + Math.random() * 110 });
  }
}

/** Клик с лёгким «дрожанием» курсора перед нажатием. */
export async function humanClick(locator, cfg) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox().catch(() => null);
  const page = locator.page();
  if (box) {
    await page.mouse.move(
      box.x + box.width / 2 + (Math.random() * 20 - 10),
      box.y + box.height / 2 + (Math.random() * 10 - 5),
      { steps: 8 + Math.floor(Math.random() * 10) },
    );
    await sleep(120 + Math.random() * 300);
  }
  await locator.click({ force: !box });
}

/** Скриншот для диагностики сбоя (склады в screenshots/, вне Git). */
export async function screenshot(page, name) {
  try {
    fs.mkdirSync('screenshots', { recursive: true });
    const file = path.join('screenshots', `${name}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: true });
    log.warn(`Скриншот сохранён: ${file}`);
    return file;
  } catch (e) {
    log.warn(`Не удалось сделать скриншот: ${e.message}`);
    return null;
  }
}
