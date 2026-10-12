/**
 * bot/auth.js — авторизация в панели cp.castle-host.com.
 *
 * Стратегия:
 *  1. Persistent-контекст уже может содержать живую сессию (cookies) —
 *     проверяем её без ввода логина/пароля.
 *  2. Если сессии нет — штатный вход формой по данным из .env.local.
 *  3. Если панель показала капчу:
 *     - с ключом CAPTCHA_23_CAPTCHA_KEY пробуем решить reCAPTCHA/hCaptcha через 2captcha;
 *     - иначе сохраняем скриншот и просим пройти капчу вручную (HEADLESS=false).
 *
 * Пароль существует только внутри этого процесса: в логи и уведомления
 * он не попадает ни при каких обстоятельствах.
 */
import { log } from './logger.js';
import { screenshot, humanDelay, humanType, humanClick } from './browser.js';
import { ROUTES, SELECTORS, firstMatching, anyPresent } from './selectors.js';

const NAV_TIMEOUT = 45_000;

/** Прогреваем страницу: ждём загрузки и гасим спиннеры. */
async function settle(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => {});
  const spinner = await firstMatching(page, SELECTORS.spinner, { timeoutMs: 800 });
  if (spinner) {
    await spinner.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  }
}

/** Проверяет, авторизованы ли мы: заходим на /servers и ищем маркеры входа. */
export async function isLoggedIn(page, cfg) {
  await page.goto(ROUTES.servers, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await settle(page);
  // Редирект на страницу логина — верный признак разлогиненного состояния.
  if (/login|auth|signin/i.test(page.url())) return false;
  if (await anyPresent(page, SELECTORS.loggedInMarkers)) return true;
  // Фолбэк: на странице серверов есть наши элементы управления — значит мы внутри.
  return (
    (await firstMatching(page, SELECTORS.serverCard, { timeoutMs: 2500 })) !== null &&
    !(await anyPresent(page, SELECTORS.loggedOutMarkers, { timeoutMs: 800 }))
  );
}

/** Пытается решить видимую капчу через 2captcha (если задан ключ). */
async function trySolveCaptcha(page, cfg) {
  if (!cfg.captchaKey) return false;
  try {
    const gRec = page.locator('.g-recaptcha[data-sitekey]').first();
    const hRec = page.locator('.h-captcha[data-sitekey]').first();
    let sitekey = null;
    let kind = '';
    if (await gRec.isVisible().catch(() => false)) {
      sitekey = await gRec.getAttribute('data-sitekey');
      kind = 'RecaptchaV2TaskProxyless';
    } else if (await hRec.isVisible().catch(() => false)) {
      sitekey = await hRec.getAttribute('data-sitekey');
      kind = 'HCaptchaTaskProxyless';
    }
    if (!sitekey) return false;

    log.info(`Обнаружена капча ${kind}, отправляю в решатель…`);
    const submit = await fetch('https://api.2captcha.com/createTask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientKey: cfg.captchaKey, task: { type: kind, websiteURL: page.url(), websiteKey: sitekey } }),
    }).then((r) => r.json());
    if (submit.errorId) throw new Error(`2captcha createTask: ${submit.errorDescription}`);

    let solution = null;
    for (let i = 0; i < 30 && !solution; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const res = await fetch('https://api.2captcha.com/getTaskResult', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientKey: cfg.captchaKey, taskId: submit.taskId }),
      }).then((r) => r.json());
      if (res.status === 'ready') solution = res.solution?.token;
    }
    if (!solution) throw new Error('2captcha: решение не получено за 2 минуты');

    await page.evaluate((token) => {
      const el = document.querySelector('textarea[name*="captcha" i], #g-recaptcha-response, #h-captcha-response');
      if (el) {
        el.value = token;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (window.grecaptcha?.getResponse?.()) window.grecaptcha.execute?.();
    }, solution);
    log.info('Капча решена через решатель');
    return true;
  } catch (e) {
    log.warn(`Решение капчи не удалось: ${e.message}`);
    return false;
  }
}

/** Полный цикл входа: сессия → форма → капча → повторная проверка. */
export async function login(page, cfg) {
  if (await isLoggedIn(page, cfg)) {
    log.info('Сессия активна — вход по cookies из persistent-профиля');
    return true;
  }

  log.info('Сессии нет — выполняю штатный вход в панель…');
  await page.goto(ROUTES.login, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await settle(page);
  await humanDelay(cfg);

  const email = await firstMatching(page, SELECTORS.loginEmail, { timeoutMs: 8000 });
  const pass = await firstMatching(page, SELECTORS.loginPassword, { timeoutMs: 8000 });
  if (!email || !pass) {
    await screenshot(page, 'login-form-not-found');
    throw new Error('Не нашёл поля формы входа — проверьте SELECTORS.login* в bot/selectors.js');
  }

  await humanType(email, cfg.login, cfg);
  await humanDelay(cfg);
  await humanType(pass, cfg.password, cfg); // пароль — только в память браузера, не в лог
  await humanDelay(cfg);

  if (await anyPresent(page, SELECTORS.captcha)) {
    const solved = await trySolveCaptcha(page, cfg);
    if (!solved) {
      const file = await screenshot(page, 'captcha-required');
      throw new Error(
        `Панель запросила капчу. ${cfg.captchaKey ? 'Решатель не помог.' : 'Решатель не настроен (CAPTCHA_23_CAPTCHA_KEY пуст).'} ` +
          `Запустите "npm run login:once" с HEADLESS=false и пройдите капчу вручную один раз — ` +
          `дальше бот будет использовать сохранённую сессию. Скриншот: ${file ?? 'n/a'}`,
      );
    }
  }

  const submit = await firstMatching(page, SELECTORS.loginSubmit, { timeoutMs: 5000 });
  if (submit) await humanClick(submit, cfg);
  else await pass.press('Enter');

  await settle(page);
  await page.waitForTimeout(3000);

  if (await anyPresent(page, SELECTORS.errorAlerts, { timeoutMs: 2000 })) {
    const err = await firstMatching(page, SELECTORS.errorAlerts);
    const text = (await err?.innerText().catch(() => '')) || 'неизвестная ошибка формы';
    await screenshot(page, 'login-error');
    throw new Error(`Панель отклонила учётные данные: ${text.trim()}`);
  }

  const ok = await isLoggedIn(page, cfg);
  if (ok) log.info('Вход выполнен успешно, сессия сохранена в профиле');
  else {
    await screenshot(page, 'login-failed');
    throw new Error('После отправки формы вход не подтвердился (см. screenshots/login-failed-*.png)');
  }
  return ok;
}
