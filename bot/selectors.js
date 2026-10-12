/**
 * bot/selectors.js — «карта» панели Castle Host (cp.castle-host.com).
 *
 * Панели хостингов регулярно меняют вёрстку, поэтому каждый элемент описан
 * СПИСКОМ устойчивых вариантов: сначала data-атрибуты и aria-*, затем role*,
 * затем текстовые матчеры (локализация не завязана на классы), и только
 * в самом конце — CSS-классы как последний фолбэк.
 *
 * Функция firstMatching() перебирает варианты и возвращает первый реально
 * найденный локатор — это даёт запас прочности при редизайне панели.
 */

export const BASE_URL = 'https://cp.castle-host.com';

/** Маршруты панели (уточняются один раз в этом файле при смене структуры). */
export const ROUTES = {
  login: `${BASE_URL}/login`,
  dashboard: `${BASE_URL}/dashboard`,
  servers: `${BASE_URL}/servers`,
  serverDetail: (id) => `${BASE_URL}/servers/${encodeURIComponent(id)}`,
  billing: `${BASE_URL}/billing`,
};

/** Селектор поля формы по label / name / placeholder / aria-label. */
const field = (...names) =>
  names.flatMap((n) => [
    `[aria-label*="${n}"i]`,
    `input[name*="${n}"i]`,
    `input[id*="${n}"i]`,
    `input[placeholder*="${n}"i]`,
    `label:has-text("${n}") + input`,
    `label:has-text("${n}") ~ input`,
  ]);

/** Кнопка/ссылка по тексту (устойчиво к смене классов, чувствительно к локализации). */
const btn = (...texts) => texts.map((t) => `button:has-text("${t}"), a:has-text("${t}")`);

export const SELECTORS = {
  /** Форма входа. */
  loginForm: ['form', '[data-testid="login-form"]', 'form[action*="login"]'],
  loginEmail: field('e-mail', 'email', 'почт', 'логин', 'login'),
  loginPassword: ['input[type="password"]', ...field('пароль', 'password')],
  loginSubmit: [
    'button[type="submit"]',
    '[data-testid="login-submit"]',
    ...btn('войти', 'вход', 'логин', 'sign in', 'login'),
  ],

  /** Признаки того, что мы залогинены (любой из маркеров достаточно). */
  loggedInMarkers: [
    '[data-testid="user-menu"]',
    '[aria-label*="профил"i]',
    '[aria-label*="logout"i]',
    'a[href*="logout"]',
    ...btn('выйти', 'выход', 'logout', 'sign out'),
  ],
  /** Признаки того, что панель просит войти. */
  loggedOutMarkers: ['input[type="password"]', ...btn('войти', 'вход', 'login')],

  /** Ошибки авторизации («неверный пароль», «капча обязательна» …). */
  errorAlerts: ['[role="alert"]', '.alert-danger', '.error', '[data-testid*="error"]'],

  /** Капча любого вида. */
  captcha: [
    'iframe[src*="recaptcha"]',
    'iframe[src*="hcaptcha"]',
    '[class*="g-recaptcha"]',
    '[class*="h-captcha"]',
    'img[alt*="капча"i]',
    'input[name*="captcha"i]',
  ],

  /** Карточка сервера на странице списка серверов. */
  serverCard: [
    `[data-server-id]`,
    `[data-testid*="server"]`,
    `article`,
    `.server-card, .server`,
  ],

  /** Статус сервера: текст/атрибуты внутри карточки или на странице сервера. */
  statusOnline: [
    '[data-status="online"]', '[data-state="running"]', '[data-testid="status-online"]',
    '.status-online', '.badge-online',
    ':text("онлайн"), :text("запущен"), :text("работает"), :text("online"), :text("running")',
  ],
  statusOffline: [
    '[data-status="offline"]', '[data-state="stopped"]', '[data-testid="status-offline"]',
    '.status-offline', '.badge-offline',
    ':text("офлайн"), :text("выключен"), :text("остановлен"), :text("stopped"), :text("offline")',
  ],

  /** Кнопка «Включить сервер». */
  startButton: [
    '[data-action="start"]', '[data-testid="server-start"]',
    'button[aria-label*="включ"i]', 'button[data-toggle="start"]',
    ...btn('включить', 'запустить', 'стартовать', 'start'),
  ],
  /** Кнопка «Выключить» — её наличие косвенно подтверждает, что сервер онлайн. */
  stopButton: [
    '[data-action="stop"]', '[data-testid="server-stop"]',
    'button[aria-label*="выключ"i]',
    ...btn('выключить', 'остановить', 'stop'),
  ],

  /** Продление аренды / оплата. */
  renewButton: [
    '[data-action="renew"]', '[data-testid="renew"]',
    'button[aria-label*="продл"i]',
    ...btn('продлить', 'продление', 'renew'),
  ],
  renewPeriod: [
    'select[name*="period"i]', 'select[aria-label*="период"i]',
    '[data-testid="renew-period"]', 'select',
  ],
  payFromBalance: [
    '[data-testid="pay-balance"]', 'input[value="balance"]',
    'label:has-text("баланс")', ...btn('баланс', 'balance'),
  ],
  confirmPayment: [
    'button[type="submit"][data-action*="pay" i]',
    '[data-testid="confirm-payment"]',
    ...btn('оплатить', 'подтвердить', 'pay', 'confirm'),
  ],
  /** Диалог подтверждения оплаты. */
  modalConfirm: [
    '[role="dialog"] button:has-text("да")',
    '[role="dialog"] [data-testid="modal-confirm"]',
    ...btn('подтвердить', 'ok', 'да'),
  ],
  successAlerts: ['.alert-success', '[role="status"]', '[data-testid*="success"]'],

  /** Баланс аккаунта (для диагностики «недостаточно средств»). */
  balance: ['[data-testid="balance"]', '[class*="balance"]', ':text("баланс")'],

  /** Индикатор загрузки на странице. */
  spinner: ['.spinner', '.loader', '[role="progressbar"]', '[class*="loading"]'],
};

/**
 * Возвращает первый локатор из списка вариантов, который что-то находит
 * на странице (или null, если не найден ни один).
 */
export async function firstMatching(page, variants, { timeoutMs = 1500 } = {}) {
  for (const sel of variants) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: 'attached', timeout: timeoutMs });
      return loc;
    } catch {
      /* пробуем следующий вариант */
    }
  }
  return null;
}

/** True, если хотя бы один вариант селектора присутствует на странице. */
export async function anyPresent(page, variants, { timeoutMs = 1200 } = {}) {
  return (await firstMatching(page, variants, { timeoutMs })) !== null;
}
