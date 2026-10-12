/**
 * bot/api.js — ПРОДАКШЕН-РЕЖИМ: прямой HTTP-клиент панели Castle Host.
 *
 * Никакой эмуляции браузера: обычный fetch + cookie-jar. Сессия (cookies)
 * хранится в зашифрованном файле SESSION_DIR/session.json (AES-256-GCM,
 * ключ — SESSION_SECRET из .env.local), пароль на диске не остаётся никогда.
 *
 * Как это работает без DOM-эмуляции:
 *  1. discover() — один раз «изучает» панель по HTTP: скачивает страницы
 *     /login, /servers, /billing и по устойчивым признакам (name/hidden-поля
 *     форм, action URL, CSRF-токены, текст кнопок, ссылки на серверы, даты
 *     «оплачен до») определяет реальные эндпоинты и поля. Результат
 *     сохраняется в api-profile.json — его можно подсмотреть и при
 *     необходимости поправить вручную, не трогая код.
 *  2. login() — POST учётных данных на найденный action формы входа.
 *  3. status/renew/start — GET/POST на найденные эндпоинты; если точный
 *     API-эндпоинт действия не обнаружен, выполняется «HTTP-эквивалент
 *     клика»: отправка той же формы/ссылки, что отправляет браузер
 *     (без рендеринга, JS и эмуляции мыши).
 *
 * Все чувствительные данные — только из .env.local.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/* ------------------------------------------------------------------ */
/* Cookie jar (минимальный, RFC-ish: domain/path/expiry/secure)        */
/* ------------------------------------------------------------------ */

export class CookieJar {
  constructor() {
    /** @type {Map<string, {name:string,value:string,domain:string,path:string,expires:number|null,secure:boolean}>} */
    this.cookies = new Map();
  }

  static key(c) {
    return `${c.domain}::${c.path}::${c.name}`;
  }

  setCookie(raw, requestUrl) {
    const parts = raw.split(';').map((s) => s.trim());
    if (!parts.length || !parts[0].includes('=')) return;
    const [name, ...rest] = parts[0].split('=');
    const value = rest.join('=');
    let domain = '';
    let cpath = '/';
    let expires = null;
    let secure = false;
    for (const p of parts.slice(1)) {
      const [k, ...v] = p.split('=');
      const kk = k.toLowerCase();
      const vv = v.join('=');
      if (kk === 'domain') domain = vv.replace(/^\./, '').toLowerCase();
      else if (kk === 'path') cpath = vv || '/';
      else if (kk === 'expires') {
        const t = Date.parse(vv);
        if (!Number.isNaN(t)) expires = t;
      } else if (kk === 'max-age') {
        const s = Number(vv);
        if (Number.isFinite(s)) expires = Date.now() + s * 1000;
      } else if (kk === 'secure') secure = true;
    }
    if (!domain) {
      try {
        domain = new URL(requestUrl).hostname.toLowerCase();
      } catch {
        return;
      }
    }
    const c = { name, value, domain, path: cpath, expires, secure };
    if (value === '' || (expires !== null && expires < Date.now())) {
      this.cookies.delete(CookieJar.key(c));
      return;
    }
    // Замена существующей куки с тем же именем/доменом/путём.
    for (const [k, old] of this.cookies) {
      if (old.name === name && old.domain === domain && old.path === cpath) this.cookies.delete(k);
    }
    this.cookies.set(CookieJar.key(c), c);
  }

  /** Cookies, подходящие для URL запроса (в формате заголовка). */
  headerFor(url) {
    let host;
    let pth;
    let isHttps;
    try {
      const u = new URL(url);
      host = u.hostname.toLowerCase();
      pth = u.pathname || '/';
      isHttps = u.protocol === 'https:';
    } catch {
      return '';
    }
    const now = Date.now();
    const out = [];
    for (const c of [...this.cookies.values()].sort((a, b) => b.path.length - a.path.length)) {
      if (c.expires !== null && c.expires < now) {
        this.cookies.delete(CookieJar.key(c));
        continue;
      }
      if (c.secure && !isHttps) continue;
      const hostOk = host === c.domain || host.endsWith(`.${c.domain}`);
      const pathOk = pth === c.path || pth.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`) || c.path === '/';
      if (hostOk && pathOk) out.push(`${c.name}=${c.value}`);
    }
    return out.join('; ');
  }

  toJSON() {
    return [...this.cookies.values()];
  }

  static fromJSON(list) {
    const jar = new CookieJar();
    for (const c of list || []) if (c?.name && c?.domain) jar.cookies.set(CookieJar.key(c), c);
    return jar;
  }
}

/* ------------------------------------------------------------------ */
/* Шифрование сессии на диске (AES-256-GCM, ключ — SESSION_SECRET)     */
/* ------------------------------------------------------------------ */

function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

export function encryptJson(obj, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: enc.toString('base64') });
}

export function decryptJson(text, secret) {
  const o = JSON.parse(text);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(o.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(o.tag, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(o.data, 'base64')), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

/* ------------------------------------------------------------------ */
/* Мини-парсер HTML (без зависимостей): формы, input, a[href], текст   */
/* ------------------------------------------------------------------ */

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/** Все теги указанного типа с атрибутами и внутренним текстом. */
export function parseTags(html, tag) {
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)(?:<\\/${tag}>|$)`, 'gi');
  const attrsRe = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'|([\w:-]+)\s*=\s*([^\s"'>]+)/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    let a;
    while ((a = attrsRe.exec(m[1]))) {
      const k = (a[1] || a[3] || a[5] || '').toLowerCase();
      const v = decodeEntities(a[2] ?? a[4] ?? a[6] ?? '');
      if (k) attrs[k] = v;
    }
    out.push({ attrs, text: decodeEntities(m[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(), raw: m[2] });
  }
  return out;
}

/** <input>-теги внутри произвольного HTML-фрагмента. */
export function parseInputs(html) {
  const re = /<input\b([^>]*?)\/?>/gi;
  const attrsRe = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    let a;
    while ((a = attrsRe.exec(m[1]))) attrs[(a[1] || a[3]).toLowerCase()] = decodeEntities(a[2] ?? a[4] ?? '');
    out.push(attrs);
  }
  return out;
}

/** Формы: {action, method, inputs:[{name,type,value}], id, cls}. */
export function parseForms(html, baseUrl) {
  return parseTags(html, 'form').map((f) => {
    const action = f.attrs.action ? new URL(f.attrs.action, baseUrl).href : baseUrl;
    return {
      action,
      method: (f.attrs.method || 'get').toUpperCase(),
      id: f.attrs.id || '',
      cls: f.attrs.class || '',
      inputs: parseInputs(f.raw).filter((i) => i.name),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Распознавание элементов панели по устойчивым признакам              */
/* ------------------------------------------------------------------ */

const RX_LOGIN_FORM = /(email|e-mail|почт|login|user|логин)/i;
const RX_CSRF = /(csrf|xsrf|_token|authenticity|nonce|token)/i;
const RX_START = /(включ|запуст|старт|start|power\s*-?\s*on|turn\s*on|resume|boot)/i;
const RX_STOP = /(выключ|останов|stop|shutdown|power\s*-?\s*off|suspend)/i;
const RX_RENEW = /(продл|renew|extend|oplat\w*\s*do|pay\s*for)/i;
const RX_BALANCE = /(баланс|balance|account\s*fund|internal)/i;
const RX_PAY = /(оплат|подтверд|pay|confirm|proceed)/i;
const RX_ONLINE = /(онлайн|запущен|запускается|работает|active|running|\bonline\b|\brunning\b)/i;
const RX_OFFLINE = /(офлайн|выключен|остановлен|остановлен|выключить не\w*|offline|stopped|halted|terminated|\boff\b)/i;
const RX_EXPIRES = /(окончан|оплачен\s*до|действует\s*до|expire|end[-_\s]?date|due|next[-_\s]?payment|rent)/i;
const RX_DATE =
  /(?:(\d{4})-(\d{2})-(\d{2})|(\d{2})[.\/](\d{2})[.\/](\d{4}))(?:\s+(\d{1,2}):(\d{2}))?/;

function pickInput(inputs, rxType, rxName) {
  return (
    inputs.find((i) => (i.type || '').toLowerCase() === rxType) ||
    inputs.find((i) => rxName.test(i.name || '') && !/hidden/i.test(i.type || '')) ||
    inputs.find((i) => rxName.test(i.name || ''))
  );
}

/** Извлекает дату окончания аренды из HTML: сначала data-атрибуты, затем текст. */
export function extractExpiresDate(html) {
  // Вариант 1: ISO прямо в data-атрибуте — самый надёжный.
  const attr = html.match(/data-[a-z-]*(expire|end|due)[a-z-]*=["'](\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?)["']/i);
  if (attr) {
    const d = new Date(attr[2].replace(' ', 'T'));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ');
  // Вариант 2: ищем подпись «оплачен до / expires» и берём первую дату ПОСЛЕ неё
  // (в пределах ~60 символов — дата обычно стоит сразу за подписью).
  const rxLabel = /(окончан\w*|оплачен\s*до|действует\s*до|expires?|end[-_\s]?date|due\s*date|next[-_\s]?payment)/gi;
  let m;
  while ((m = rxLabel.exec(text))) {
    const after = text.slice(m.index, m.index + 80);
    const dm = after.match(RX_DATE);
    if (!dm) continue;
    const d = dm[1]
      ? new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(dm[7] || 0), Number(dm[8] || 0))
      : new Date(Number(dm[6]), Number(dm[5]) - 1, Number(dm[4]), Number(dm[7] || 0), Number(dm[8] || 0));
    if (!Number.isNaN(d.getTime()) && d.getFullYear() > 2000) return d;
  }
  return null;
}

/** Статус по HTML блока сервера: сначала явные data-атрибуты, затем текст. */
export function extractStatus(html) {
  const st = html.match(/data-(?:status|state)=["']([^"']+)["']/i)?.[1]?.toLowerCase() || '';
  if (/online|running|active|started/.test(st)) return 'online';
  if (/offline|stopped|halted|terminated/.test(st)) return 'offline';
  const text = html.replace(/<[^>]*>/g, ' ');
  // Индикатор «выключен» содержит подстроку «включен» — сравниваем позиции.
  const mOn = text.search(RX_ONLINE);
  const mOff = text.search(RX_OFFLINE);
  if (mOff >= 0 && (mOn < 0 || mOff <= mOn)) return 'offline';
  if (mOn >= 0) return 'online';
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/* ApiClient                                                           */
/* ------------------------------------------------------------------ */

export class ApiClient {
  /**
   * @param {object} cfg  конфигурация из config.js
   * @param {{log?:{info:Function,warn:Function,error:Function,debug:Function}}} logger
   */
  constructor(cfg, logger) {
    this.cfg = cfg;
    this.log = logger;
    this.baseUrl = cfg.baseUrl;
    this.jar = new CookieJar();
    this.profilePath = path.resolve(cfg.apiProfile || './api-profile.json');
    this.sessionPath = path.join(cfg.sessionDir, 'session.json');
    this.profile = null;
    this._failCount = 0;
  }

  /* ------------------------- транспорт ------------------------- */

  async request(url, { method = 'GET', headers = {}, body = null, follow = true } = {}) {
    const h = {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'ru,en;q=0.9',
      referer: this.baseUrl + '/',
      cookie: this.jar.headerFor(url),
      ...headers,
    };
    if (h.cookie === '') delete h.cookie;
    const res = await fetch(url, { method, headers: h, body, redirect: follow ? 'follow' : 'manual' });
    for (const sc of res.headers.getSetCookie?.() || []) this.jar.setCookie(sc, url);
    const text = await res.text();
    return { res, text, url: res.url || url };
  }

  get(url) {
    return this.request(url);
  }

  /** POST формы (как отправляет браузер), с CSRF-полем профиля. */
  async postForm(url, fields, { csrfFrom = null } = {}) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form.set(k, String(v));
    if (csrfFrom?.csrfField && this.csrf) form.set(csrfFrom.csrfField, this.csrf);
    const res = await this.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    this._maybeDetectCaptcha(res.text);
    return res;
  }

  _maybeDetectCaptcha(html) {
    if (/<iframe[^>]+(recaptcha|hcaptcha)|captcha[_-]?(required|invalid|error)/i.test(html)) {
      this.log.warn('Похоже, панель требует капчу на стороне HTTP-запроса.');
      this.log.warn('Продакшен-режим не решает капчу сам: откройте панель в браузере, пройдите её и обновите сессию: npm run auth');
    }
  }

  /* ------------------------- профиль API ------------------------- */

  loadProfile() {
    try {
      this.profile = JSON.parse(fs.readFileSync(this.profilePath, 'utf8'));
      this.log.debug(`Загружен профиль API: ${this.profilePath}`);
      return this.profile;
    } catch {
      return null;
    }
  }

  saveProfile(p) {
    this.profile = p;
    fs.writeFileSync(this.profilePath, JSON.stringify(p, null, 2));
    this.log.info(`Профиль эндпоинтов сохранён: ${this.profilePath} (можно править вручную)`);
  }

  /**
   * discover(): изучает панель по HTTP и заполняет профиль эндпоинтов.
   * Вызывается автоматически при первом запуске или командой `npm run discover`.
   */
  async discover() {
    this.log.info('Режим discovery: определяю эндпоинты панели по HTTP…');
    // Профиль единый объект: this.profile === p (важно для persistSession/saveProfile).
    if (!this.profile) {
      this.profile = {
        baseUrl: this.baseUrl,
        discoveredAt: new Date().toISOString(),
        login: null,
        serversListUrl: `${this.baseUrl}/servers`,
        serverDetailUrl: null,
        status: null, // {kind:'list'|'detail'|'page-text'}
        start: null, // {method,url,fields,csrfField}
        renew: null,
        pay: null,
        expiresSelector: null, // dateFoundIn:'attribute'|'text'
        notes: 'Если панель сменит вёрстку — запустите `npm run discover` заново или поправьте этот JSON вручную.',
      };
    }
    const p = this.profile;
    p.discoveredAt = new Date().toISOString();

    // 1. Страница логина → форма, поля, CSRF.
    const loginPage = await this.get(`${this.baseUrl}/login`).catch(() => null);
    if (loginPage) {
      const forms = parseForms(loginPage.text, loginPage.url);
      const lf =
        forms.find((f) => f.inputs.some((i) => (i.type || '') === 'password')) ||
        forms.find((f) => f.inputs.some((i) => RX_LOGIN_FORM.test(i.name || '')));
      if (lf) {
        const email = pickInput(lf.inputs, 'email', RX_LOGIN_FORM) || lf.inputs.find((i) => !/password|hidden/i.test(i.type || ''));
        const pass = lf.inputs.find((i) => (i.type || '') === 'password');
        const csrf = lf.inputs.find((i) => RX_CSRF.test(i.name || '') && (i.type || '') === 'hidden');
        p.login = {
          method: lf.method === 'POST' ? 'POST' : 'POST',
          url: lf.action,
          userField: email?.name || 'email',
          passField: pass?.name || 'password',
          csrfField: csrf?.name || null,
          csrfValue: csrf?.value || null,
          extraFields: lf.inputs
            .filter((i) => (i.type || '') === 'hidden' && i.name !== csrf?.name && RX_CSRF.test(i.name || ''))
            .map((i) => ({ name: i.name, value: i.value || '' })),
        };
        this.log.info(`Форма входа: ${p.login.url} (${p.login.userField}/${p.login.passField}${p.login.csrfField ? ', CSRF ' + p.login.csrfField : ''})`);
      } else {
        this.log.warn('На /login не найдена форма с паролем — возможно, вход по API. Укажите CASTLE_API_LOGIN_URL вручную в api-profile.json.');
      }
    }

    // 2. Список серверов (нужна авторизация; если не залогинены — попробуем позже).
    try {
      // ВАЖНО: внутри discover() вызываем loginHttp напрямую — ensureLogin()
      // рекурсивно вернулся бы в discover() и ушёл в бесконечный цикл.
      if (!(await this.ensureSession())) await this.loginHttp();
      const list = await this.get(p.serversListUrl);
      if (/login|signin/i.test(list.url) === false) {
        // Детальная страница нашего сервера: ссылка, содержащая ID.
        const links = parseTags(list.text, 'a').filter((a) => a.attrs.href && a.attrs.href.includes(String(this.cfg.serverId)));
        if (links.length) {
          p.serverDetailUrl = new URL(links[0].attrs.href, list.url).href;
          this.log.info(`Страница сервера: ${p.serverDetailUrl}`);
        }
        // Дата окончания аренды.
        const d = extractExpiresDate(list.text);
        if (d) {
          p.expiresSelector = { dateFoundIn: /data-[a-z-]*expire/i.test(list.text) ? 'attribute' : 'text' };
          this.log.info(`Дата окончания аренды найдена на списке: ${d.toISOString()}`);
        }
        // Кнопки/формы действий на странице сервера.
        if (p.serverDetailUrl) {
          const detail = await this.get(p.serverDetailUrl);
          this._discoverActions(p, detail.text, detail.url);
          if (!p.expiresSelector) {
            const d2 = extractExpiresDate(detail.text);
            if (d2) {
              p.expiresSelector = { dateFoundIn: /data-[a-z-]*expire/i.test(detail.text) ? 'attribute' : 'text' };
              this.log.info(`Дата окончания аренды найдена на странице сервера: ${d2.toISOString()}`);
            }
          }
        }
      }
    } catch (e) {
      this.log.warn(`Discovery части «после входа» не завершён: ${e.message}. Экшены будут определены по умолчанию.`);
    }

    // 3. Фолбэк-экшены по типичным REST-паттернам панелей (проверяются HEAD/GET).
    if (!p.start) p.start = await this._probeAction(['start', 'power-on', 'boot', 'on'], p.serverDetailUrl);
    if (!p.renew) p.renew = await this._probeAction(['renew', 'extend'], p.serverDetailUrl);
    if (!p.status) p.status = { kind: 'page-text' };

    this.saveProfile(p);
    this.log.info('Discovery завершён. Проверьте/скорректируйте api-profile.json при необходимости.');
    return p;
  }

  _discoverActions(p, html, pageUrl) {
    const forms = parseForms(html, pageUrl);
    const buttons = parseTags(html, 'button').concat(parseTags(html, 'a'));

    const findAction = (rxLabel, rxUrlHint) => {
      // 1) Форма, у которой action/name содержит подсказку.
      const byForm = forms.find(
        (f) => rxUrlHint.test(f.action) || f.inputs.some((i) => rxUrlHint.test(i.name || '')),
      );
      if (byForm) {
        const csrf = byForm.inputs.find((i) => RX_CSRF.test(i.name || '') && (i.type || '') === 'hidden');
        return {
          method: byForm.method,
          url: byForm.action,
          fields: byForm.inputs.filter((i) => (i.type || '') !== 'submit').map((i) => ({ name: i.name, value: i.value || '' })),
          csrfField: csrf?.name || null,
        };
      }
      // 2) Ссылка/кнопка вида GET /servers/{id}/actions/start.
      const link = buttons.find(
        (b) => b.attrs.href && rxUrlHint.test(b.attrs.href) && rxLabel.test(b.text || b.attrs['aria-label'] || ''),
      );
      if (link) return { method: 'GET', url: new URL(link.attrs.href, pageUrl).href, fields: [], csrfField: null };
      // 3) data-action на кнопке → предполагаем POST на страницу.
      const da = html.match(new RegExp(`data-action=["']([^"']*(?:${rxUrlHint.source})[^"']*)["']`, 'i'));
      if (da) return { method: 'POST', url: pageUrl, fields: [{ name: 'action', value: da[1] }], csrfField: null };
      return null;
    };

    p.start = findAction(RX_START, /start|power|boot|on\b/i);
    p.renew = findAction(RX_RENEW, /renew|extend/i);
    p.pay = findAction(RX_PAY, /pay|confirm|balance|checkout/i);
    if (p.start) this.log.info(`Экшен «Включить»: ${p.start.method} ${p.start.url}`);
    if (p.renew) this.log.info(`Экшен «Продлить»: ${p.renew.method} ${p.renew.url}`);
    if (p.pay) this.log.info(`Экшен «Оплата с баланса»: ${p.pay.method} ${p.pay.url}`);
    // Блок статуса: ищем контейнер с нашим ID или словом status.
    if (/data-(status|state)=/i.test(html)) p.status = { kind: 'detail' };
  }

  async _probeAction(hints, detailUrl) {
    const base = detailUrl || `${this.baseUrl}/servers/${encodeURIComponent(this.cfg.serverId)}`;
    for (const hint of hints) {
      for (const tpl of [`${base}/${hint}`, `${base}/actions/${hint}`]) {
        try {
          const r = await this.request(tpl, { method: 'HEAD' }).catch(async () => this.get(tpl));
          if (r.res.status && r.res.status < 500 && !/login/i.test(r.url)) {
            return { method: 'POST', url: tpl, fields: [], csrfField: null, probed: true };
          }
        } catch {
          /* следующий кандидат */
        }
      }
    }
    return null;
  }

  /* ------------------------- сессия на диске ------------------------- */

  /** Сохраняет cookies зашифрованными (ключ SESSION_SECRET). */
  persistSession() {
    if (!this.cfg.sessionSecret) {
      this.log.warn('SESSION_SECRET не задан — сессия НЕ сохраняется на диск (вход каждый запуск).');
      return;
    }
    fs.mkdirSync(this.cfg.sessionDir, { recursive: true });
    const payload = { savedAt: new Date().toISOString(), cookies: this.jar.toJSON(), profile: this.profile };
    fs.writeFileSync(this.sessionPath, encryptJson(payload, this.cfg.sessionSecret), { mode: 0o600 });
    this.log.debug('Сессия (cookies) сохранена зашифрованной');
  }

  restoreSession() {
    try {
      const raw = fs.readFileSync(this.sessionPath, 'utf8');
      const obj = this.cfg.sessionSecret
        ? decryptJson(raw, this.cfg.sessionSecret)
        : JSON.parse(raw);
      this.jar = CookieJar.fromJSON(obj.cookies);
      if (obj.profile && !this.profile) this.profile = obj.profile;
      this.log.info(`Восстановлена сессия от ${obj.savedAt || '?'}`);
      return true;
    } catch {
      return false;
    }
  }

  /* ------------------------- авторизация ------------------------- */

  /** Пробует восстановить сессию из файла и проверить её живость. */
  async ensureSession() {
    if (this.restoreSession()) {
      const ok = await this.checkAuth();
      if (ok) return true;
      this.log.info('Сохранённая сессия истекла — выполняю повторный вход');
    }
    return false;
  }

  /**
   * Полная подготовка клиента: профиль эндпоинтов + живая сессия (или вход).
   * Рекурсии discover→login нет: discover сам вызывает loginHttp напрямую.
   */
  async ensureLogin() {
    if (this._loggingIn) return; // защита от рекурсии внутри одного цикла
    if (!this.profile) this.loadProfile();
    if (!this.profile) {
      await this.discover(); // discover уже выполняет вход и сохраняет сессию
      return;
    }
    if (!(await this.ensureSession())) {
      this._loggingIn = true;
      try { await this.loginHttp(); } finally { this._loggingIn = false; }
      this.persistSession(); // обновляем файл (profile мог измениться)
    }
  }

  /** Живая ли сессия: /servers должен отдавать контент, а не редирект на /login. */
  async checkAuth() {
    try {
      const r = await this.get(`${this.baseUrl}/servers`);
      // Только путь страницы ЛОГИНА означает слёт сессии (не '/auth/login' и не любые «login» в тексте).
      let redirected;
      try {
        const pn = new URL(r.url).pathname.replace(/\/+$/, '');
        redirected = /(\/login$|\/signin$)/i.test(pn);
      } catch {
        redirected = false;
      }
      const hasUi = /data-(status|server-id)|logout|выйти|servers\//i.test(r.text);
      return !redirected && hasUi;
    } catch (e) {
      this.log.warn(`checkAuth: ${e.message}`);
      return false;
    }
  }

  /** Вход POST-формой по профилю. Пароль — только в теле запроса. */
  async loginHttp() {
    if (!this.profile) this.loadProfile();
    const lp = this.profile?.login;
    if (!lp) throw new Error('В api-profile.json нет блока login — запустите `npm run discover`');

    const fields = { [lp.userField]: this.cfg.login, [lp.passField]: this.cfg.password };
    for (const e of lp.extraFields || []) fields[e.name] = e.value;
    const headers = {};
    if (lp.csrfField && lp.csrfValue) fields[lp.csrfField] = lp.csrfValue;
    else if (lp.csrfField) {
      // актуальный токен берём со свежей страницы логина
      const page = await this.get(lp.url);
      const form = parseForms(page.text, page.url).find((f) => f.action === lp.url) || null;
      const tok = form?.inputs.find((i) => i.name === lp.csrfField);
      if (tok?.value) fields[lp.csrfField] = tok.value;
    }
    const res = await this.request(lp.url, {
      method: lp.method || 'POST',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded', origin: this.baseUrl },
      body: new URLSearchParams(fields).toString(),
    });
    this._maybeDetectCaptcha(res.text);

    // Успех = ушли со страницы логина (302→/servers или сразу отдали панель).
    const stillLoginForm = /<form[^>]+action|type=["']password["']/i.test(res.text) && !/data-server-id|logout|выйти/i.test(res.text);
    const onLoginPage = new URL(res.url).pathname.toLowerCase().includes('login');
    const okByRedirect = !onLoginPage || !stillLoginForm;
    const bad = stillLoginForm && /неверн|incorrect|invalid|wrong|failed|error/i.test(res.text);
    if (bad || !okByRedirect) {
      this._failCount++;
      if (this._failCount >= 3) {
        throw new Error('3 неудачных входа подряд — проверьте CASTLE_LOGIN/CASTLE_PASSWORD в .env.local (возможна блокировка панели)');
      }
      throw new Error(`Вход отклонён панелью (попытка ${this._failCount})`);
    }
    this._failCount = 0;
    this.csrf = null;
    // Профиль на disk пишет только discover()/saveProfile(); здесь сохраняем
    // сессию, а копию профиля кладём внутрь шифрованного session-файла.
    this.persistSession();
    this.log.info('HTTP-вход выполнен успешно, cookies сохранены');
    return true;
  }

  /* ------------------------- бизнес-операции ------------------------- */

  _detailUrl() {
    return this.profile?.serverDetailUrl || `${this.baseUrl}/servers/${encodeURIComponent(this.cfg.serverId)}`;
  }

  /** Статус сервера: online | offline | unknown (парсинг HTML без браузера). */
  async getStatus() {
    await this.ensureLogin();
    // Сначала список (там блок с нашим ID), затем детальная страница.
    for (const url of [this.profile?.serversListUrl, this._detailUrl()]) {
      if (!url) continue;
      try {
        const r = await this.get(url);
        if (/(\/login$|\/signin$)/i.test(new URL(r.url).pathname.replace(/\/+$/, ''))) continue; // сессия слетела
        // Сужаем область поиска статуса к блоку нашего сервера: режем HTML вокруг
        // каждого вхождения ID в атрибутах/URL — иначе статус может «прийти» из шапки.
        for (const mt of [...r.text.matchAll(new RegExp(`["'][^"']*${this.cfg.serverId}[^"']*["']`, 'g'))]) {
          const from = Math.max(0, mt.index - 300);
          const to = Math.min(r.text.length, mt.index + 1200);
          const st = extractStatus(r.text.slice(from, to));
          if (st !== 'unknown') return st;
        }
        const st = extractStatus(r.text);
        if (st !== 'unknown') return st;
      } catch (e) {
        this.log.warn(`getStatus на ${url}: ${e.message}`);
      }
    }
    return 'unknown';
  }

  /** Дата окончания аренды (null, если не найдена). */
  async getRentEndDate() {
    await this.ensureLogin();
    for (const url of [this._detailUrl(), this.profile?.serversListUrl, `${this.baseUrl}/billing`]) {
      if (!url) continue;
      try {
        const r = await this.get(url);
        const d = extractExpiresDate(r.text);
        if (d) return d;
      } catch (e) {
        this.log.debug(`getRentEndDate на ${url}: ${e.message}`);
      }
    }
    return null;
  }

  /** Баланс аккаунта (число или null) — для диагностики оплаты. */
  async getBalance() {
    try {
      const r = await this.get(`${this.baseUrl}/billing`);
      const m = r.text.replace(/<[^>]*>/g, ' ').match(/баланс[^\d]{0,40}([\d\s]{1,15}[.,]?\d{0,2})/i);
      if (m) return Number(m[1].replace(/\s/g, '').replace(',', '.'));
    } catch {
      /* не критично */
    }
    return null;
  }

  /** Выполняет экшен из профиля (HTTP-эквивалент клика). */
  async _runAction(spec, label) {
    if (!spec) throw new Error(`Экшен «${label}» не определён в api-profile.json — выполните \`npm run discover\``);
    if (spec.method === 'GET') {
      const r = await this.get(spec.url);
      this._maybeDetectCaptcha(r.text);
      return r.res.ok && !/login/i.test(r.url);
    }
    const fields = {};
    for (const f of spec.fields || []) fields[f.name] = f.value;
    const res = await this.postForm(spec.url, fields, { csrfFrom: spec });
    return res.res.ok && !/login/i.test(res.url);
  }

  /** Включение сервера + подтверждение перехода в online. */
  async startServer() {
    await this.ensureLogin();
    const before = await this.getStatus();
    if (before === 'online') return true;
    await this._runAction(this.profile?.start, 'Включить сервер');
    // Ждём boot: статус проверяем каждые ~10 секунд до 2 минут.
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 10_000));
      const st = await this.getStatus().catch(() => 'unknown');
      if (st === 'online') return true;
    }
    return false;
  }

  /** Продление + оплата с баланса (HTTP-эквивалент кликов «Продлить→Баланс→Оплатить→Подтвердить»). */
  async renewAndPay() {
    await this.ensureLogin();
    const steps = [
      ['renew', 'Продлить'],
      ['pay', 'Оплата с баланса'],
    ];
    let okAny = false;
    for (const [key, label] of steps) {
      const spec = this.profile?.[key];
      if (!spec) {
        this.log.warn(`Экшен «${label}» не найден в профиле — пропускаю шаг (проверьте api-profile.json)`);
        continue;
      }
      okAny = (await this._runAction(spec, label)) || okAny;
      await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 1500)));
    }
    if (!okAny) throw new Error('Ни один шаг продления не подтверждён панелью');
    // Проверяем результат: дата окончания должна сдвинуться вперёд.
    const after = await this.getRentEndDate();
    if (!after) return false;
    const before = this._lastEndTs ?? after.getTime();
    this._lastEndTs = after.getTime();
    return after.getTime() > before - 60_000;
  }
}
