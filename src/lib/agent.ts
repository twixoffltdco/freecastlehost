/**
 * lib/agent.ts — Продакшен-клиент HostGta (user = agent)
 *
 * КЛЮЧЕВАЯ ИДЕЯ: вместо эмуляции браузера (Puppeteer) весь обмен с
 * HostGta.ru идёт напрямую через HTTP-API под единым агентом бота.
 * Один объект AgentSession = авторизованная cookie-jar сессия,
 * которая переиспользуется между запросами (keep-alive).
 *
 * Никакого JavaScript не исполняется: только fetch + разбор JSON/HTML.
 */

import { HOSTGTA_ROUTES } from './hostgta'
import type { ServerStatus } from './types'

const BASE_URL = 'https://hostgta.ru'

/** Профиль агента — учётная запись бота на HostGta */
export interface AgentProfile {
  /** Логин или e-mail агента (env: AGENT_LOGIN) */
  login: string
  /** Пароль агента (env: AGENT_PASSWORD; не нужен при AGENT_SESSION_COOKIE) */
  password: string
  /** User-Agent для реалистичности заголовков (env: AGENT_USER_AGENT) */
  userAgent: string
}

export interface VerifyResult {
  ok: boolean
  /** Найденный user_id друга, если ключ подтверждён */
  userId?: string
  error?: string
}

export interface ServerSnapshot {
  status: ServerStatus
  /** Сырой ответ API — полезен при разборе изменений формата */
  raw?: unknown
}

/**
 * Загружает профиль агента из переменных окружения.
 * Бросает понятную ошибку, если продакшен-конфиг не задан.
 */
export function loadAgentProfile(): AgentProfile {
  const login = process.env.AGENT_LOGIN
  const password = process.env.AGENT_PASSWORD
  if (!login || !password) {
    throw new Error(
      'AGENT_LOGIN / AGENT_PASSWORD не заданы в окружении. ' +
        'Продакшен-режим (user=agent) требует реальных учётных данных бота.',
    )
  }
  return {
    login,
    password,
    userAgent:
      process.env.AGENT_USER_AGENT ??
      'bothostgtagame/1.0 (+https://github.com/bothostgtagame)',
  }
}

/**
 * AgentSession — легковесный HTTP-агент без эмуляции браузера.
 * Хранит cookies после логина и отправляет каждый следующий
 * запрос уже авторизованным.
 */
export class AgentSession {
  private profile: AgentProfile
  private cookies = new Map<string, string>()
  private csrfToken: string | null = null
  private loggedIn = false

  constructor(profile: AgentProfile) {
    this.profile = profile
  }

  /* ------------------------------------------------------------------ */
  /* Низкоуровневый слой                                                 */
  /* ------------------------------------------------------------------ */

  /** Собирает заголовок Cookie из jar */
  private cookieHeader(): string {
    return [...this.cookies.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  /** Разбирает Set-Cookie и кладёт в jar */
  private absorbCookies(res: Response): void {
    const setCookie = res.headers.get('set-cookie')
    if (!setCookie) return
    for (const part of setCookie.split(',')) {
      const pair = part.trim().split(';')[0]
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      // Пропускаем протухшие cookies
      if (value && value !== 'deleted') this.cookies.set(name, value)
    }
  }

  /** Единая точка выхода в сеть: fetch + заголовки агента + cookie-jar */
  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'User-Agent': this.profile.userAgent,
      Accept: 'application/json, text/html;q=0.9',
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      ...(init.headers as Record<string, string>),
    }
    if (this.cookies.size > 0) {
      headers.Cookie = this.cookieHeader()
    }

    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      // На Vercel/edge keep-alive недоступен — просто игнорируем
      cache: 'no-store',
    })

    this.absorbCookies(res)
    return res
  }

  /* ------------------------------------------------------------------ */
  /* Авторизация агента                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Логинит агента на HostGta.
   * Если AGENT_SESSION_COOKIE задан — использует готовую сессию
   * и пропускает парольный вход (рекомендуемый продакшен-путь:
   * токен живёт дольше и не светит пароль в env).
   */
  async ensureLogin(): Promise<void> {
    if (this.loggedIn) return

    const sessionCookie = process.env.AGENT_SESSION_COOKIE
    if (sessionCookie) {
      // Инжектим готовую сессионную cookie — пароля в памяти нет
      const [name, ...rest] = sessionCookie.split('=')
      this.cookies.set(name.trim(), rest.join('=').trim())
      this.loggedIn = true
      return
    }

    const res = await this.request(HOSTGTA_ROUTES.login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        login: this.profile.login,
        password: this.profile.password,
      }).toString(),
    })

    if (!res.ok) {
      throw new Error(`Не удалось авторизовать агента: HTTP ${res.status}`)
    }
    this.loggedIn = true
  }

  /** Извлекает CSRF-токен из meta-тега страницы (если он там есть) */
  private async ensureCsrf(): Promise<string | null> {
    if (this.csrfToken !== null) return this.csrfToken
    const res = await this.request('/profile')
    if (!res.ok) return (this.csrfToken = null)
    const html = await res.text()
    const m = html.match(
      /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
    )
    this.csrfToken = m ? m[1] : null
    return this.csrfToken
  }

  /* ------------------------------------------------------------------ */
  /* Доменные операции                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Проверяет входящие заявки друга на аккаунте агента и ищет
   * пользователя, чей публичный Friend Key совпал с `key`.
   *
   * Реализация — чистый API-запрос без эмуляции: HostGta отдаёт
   * список заявок в JSON.
   */
  async verifyFriendKey(key: string): Promise<VerifyResult> {
    await this.ensureLogin()

    const res = await this.request(HOSTGTA_ROUTES.friendRequests)
    if (res.status === 401 || res.status === 403) {
      // Сессия протухла — сбрасываем флаг, чтобы следующий вызов
      // перелогинился с нуля
      this.loggedIn = false
      return { ok: false, error: 'Сессия агента истекла, повторите проверку' }
    }
    if (!res.ok) {
      return { ok: false, error: `HostGta вернул HTTP ${res.status}` }
    }

    const data: unknown = await res.json()
    const requests = extractRequests(data)

    for (const req of requests) {
      if (typeof req.friend_key === 'string' && req.friend_key === key) {
        return { ok: true, userId: String(req.user_id) }
      }
    }
    return { ok: false }
  }

  /**
   * Статус сервера пользователя — GET к странице/эндпоинту сервера.
   * Ответ нормализуется к Online/Offline/Maintenance.
   */
  async getServerStatus(serverId: string): Promise<ServerSnapshot> {
    await this.ensureLogin()

    const res = await this.request(HOSTGTA_ROUTES.serverStatus(serverId))
    if (!res.ok) {
      return { status: 'unknown', raw: { http: res.status } }
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const json = (await res.json()) as { state?: string; online?: boolean }
      return { status: normalizeStatus(json), raw: json }
    }

    // Фолбэк: парсим HTML статус-бейджа cheerio-подобным regex
    // (без эмуляции — обычный текстовый разбор)
    const html = await res.text()
    const badge = html.match(/status-(online|offline|maintenance)/i)
    return {
      status: (badge?.[1]?.toLowerCase() as ServerStatus) ?? 'unknown',
    }
  }

  /**
   * Включить сервер — POST «как нажатие кнопки в панели»,
   * но напрямую на эндпоинт управления от имени агента.
   */
  async startServer(serverId: string): Promise<boolean> {
    await this.ensureLogin()
    const csrf = await this.ensureCsrf()

    const res = await this.request(HOSTGTA_ROUTES.serverStart(serverId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: new URLSearchParams({ action: 'start' }).toString(),
    })

    return res.ok
  }

  /** Принять заявку в друзья от имени агента (опционально, для v1.1) */
  async acceptFriend(userId: string): Promise<boolean> {
    await this.ensureLogin()
    const csrf = await this.ensureCsrf()
    const res = await this.request(HOSTGTA_ROUTES.friendAccept, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: new URLSearchParams({ user_id: userId }).toString(),
    })
    return res.ok
  }
}

/* -------------------------------------------------------------------- */
/* Утилиты разбора                                                       */
/* -------------------------------------------------------------------- */

interface FriendRequestItem {
  user_id: number | string
  friend_key?: string
}

/** Приводит возможную обёртку {data:[...]} / {requests:[...]} к массиву */
function extractRequests(payload: unknown): FriendRequestItem[] {
  if (Array.isArray(payload)) return payload as FriendRequestItem[]
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    for (const key of ['data', 'requests', 'friends']) {
      if (Array.isArray(obj[key])) return obj[key] as FriendRequestItem[]
    }
  }
  return []
}

/** Нормализует поле состояния API к нашему ServerStatus */
function normalizeStatus(json: {
  state?: string
  online?: boolean
}): ServerStatus {
  if (typeof json.online === 'boolean') {
    return json.online ? 'online' : 'offline'
  }
  const s = (json.state ?? '').toLowerCase()
  if (s.includes('on') && !s.includes('off')) return 'online'
  if (s.includes('maint')) return 'maintenance'
  if (s.includes('off')) return 'offline'
  return 'unknown'
}

/** Синглтон агента на процесс — одна авторизованная сессия на все роуты */
let sharedAgent: AgentSession | null = null

export function getAgent(): AgentSession {
  if (!sharedAgent) {
    sharedAgent = new AgentSession(loadAgentProfile())
  }
  return sharedAgent
}
