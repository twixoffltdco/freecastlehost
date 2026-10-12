# bothostgtagame

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

**Open Source веб-инструмент для автоматического управления игровыми серверами
на хостинге [HostGta.ru](https://hostgta.ru).**

Пользователь генерирует уникальный **Friend Key**, добавляет бота в друзья на
HostGta.ru — и после верификации получает панель мониторинга и автозапуска своего
сервера 24/7.

## Архитектура: продакшен без эмуляции браузера (`user = agent`)

Весь обмен с HostGta.ru ведёт **один сервисный аккаунт-агент** через чистый HTTP:

```
Браузер пользователя (Dark Mode UI, localStorage)
        │  fetch + Bearer HMAC-токен
        ▼
Next.js API Routes (/api/verify-friend, /api/check-server-status, /api/cron/monitor)
        │  AgentSession (src/lib/agent.ts): cookie-jar, CSRF, JSON-API
        ▼
HostGta.ru  ◄── user = agent (реальный аккаунт бота, НЕ эмуляция Puppeteer)
```

- **Никакого Puppeteer/headless-Chrome** — только `fetch` + разбор JSON/HTML
  (`cheerio` как фолбэк-парсер). Сборка лёгкая, деплой возможен даже на Vercel.
- Секреты агента живут **только в env сервера** и никогда не попадают в браузер.
- Фоновый cron-мониторинг работает на сервере и **не зависит от localStorage**:
  при сбросе кеша браузера пользователь теряет доступ к дашборду (переверифицируется
  по ключу), но его сервер продолжает мониториться и автозапускаться.

## Основной функционал (v1.0)

1. **Генерация и верификация Friend Key**
   «Сгенерировать ключ» → криптографически стойкий hex-код (`f9eea118a6ef…`) →
   пользователь добавляет агента в друзья с этим ключом → «Проверить подключение».
   Ключ найден — статус «Успех» и доступ к панели; не найден — ошибка
   «Бот не нашел заявку. Проверьте правильность ключа и попробуйте снова» + «Повторить проверку».
2. **Мониторинг сервера 24/7 (MVP)**
   Каждые 60 минут: GET статуса сервера → если Offline → POST «включить»
   (production-запрос эндпоинта управления от имени агента) → повторная проверка.
   В дашборде: статус, uptime, время последнего чека, журнал автозапусков.

## Быстрый старт: как запустить свой инстанс

```bash
# 1. Клонируем и ставим зависимости
git clone https://github.com/<you>/bothostgtagame && cd bothostgtagame
npm install

# 2. Конфигурация агента
cp .env.example .env.local
#   заполните AGENT_LOGIN / AGENT_PASSWORD (или AGENT_SESSION_COOKIE),
#   TOKEN_SECRET и CRON_SECRET

# 3. Запуск
npm run dev            # http://localhost:3000
```

Требования: Node.js ≥ 18.17.

### Получение AGENT_SESSION_COOKIE (рекомендуется)

1. Залогиньтесь агентом на hostgta.ru в обычном браузере (Cloudflare-челлендж
   пройдёт штатно — это делает человек, а не бот).
2. DevTools → Application → Cookies → скопируйте `PHPSESSID=…` целиком.
3. Положите строку в `AGENT_SESSION_COOKIE` — пароль в env больше не нужен.

## Деплой

| Платформа | Способ |
|---|---|
| **Vercel** | `vercel --prod`; cron каждые 60 мин уже в `vercel.json` |
| **Tatnet / Onreza / Layer0 / VPS** | `docker build -t bothostgtagame .` + crontab (см. ниже) |
| **Любой хостинг с Node** | `npm run build && npm start` (output standalone) |

```cron
# фоновый мониторинг каждый час (Docker/VPS)
0 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://your-domain.ru/api/cron/monitor
```

Подробные инструкции и стратегия обхода Cloudflare без эмуляции — в
[docs/deployment.md](docs/deployment.md).

## Структура проекта

```
src/
├── app/                    # Next.js App Router
│   ├── page.tsx            # главная: генерация Friend Key + верификация
│   ├── dashboard/page.tsx  # защищённая панель мониторинга
│   └── api/
│       ├── verify-friend/route.ts         # проверка заявки у агента
│       ├── check-server-status/route.ts   # мониторинг по требованию
│       └── cron/monitor/route.ts          # фоновый цикл 24/7
├── components/             # UI (Dark Mode, адаптивный)
├── lib/
│   ├── agent.ts            # ★ AgentSession: production HTTP-клиент HostGta
│   ├── hostgta.ts          # маршруты/селекторы + парсинг (cheerio-фолбэк)
│   ├── monitor.ts          # бизнес-логика проверки/автозапуска
│   ├── crypto.ts           # генерация ключей, HMAC-токены доступа
│   └── env.ts, rate-limit.ts, types.ts …
└── store/                  # Zustand + persist в localStorage
docs/                       # deployment-гайд
.github/workflows/          # CI (typecheck+build), Docker publish
```

## Безопасность

- Все пользовательские входы санитизируются (строгий whitelist-паттерн ключа).
- Rate limiting каждого эндпоинта; cron защищён `CRON_SECRET`.
- Токен дашборда — HMAC-SHA256 с TTL 7 дней, подписывается `TOKEN_SECRET` на сервере.
- Security-заголовки (`X-Frame-Options: DENY`, `nosniff`), non-root Docker-user.

## Лицензия

[MIT](LICENSE) — используйте, форкайте и распространяйте свободно.

> ⚠️ Проект не аффилирован с HostGta.ru. Автоматизируйте только те действия,
> которые разрешены правилами хостинга; при изменении ToS ответственность
> за инстанс несёт администратор форка.
