# Деплой bothostgtagame

Проект работает в **продакшен-режиме `user = agent`**: весь обмен с HostGta.ru
ведёт один сервисный аккаунт-агент через чистый HTTP (fetch + разбор JSON/HTML).
**Эмуляция браузера (Puppeteer) не используется** — проект лёгкий и деплоится куда угодно,
включая serverless (Vercel).

Переменные окружения (полный список — в `.env.example`):

| Переменная | Обязательна | Описание |
|---|---|---|
| `AGENT_LOGIN` / `AGENT_PASSWORD` | ✅* | Логин/пароль аккаунта-агента на HostGta (*или достаточно `AGENT_SESSION_COOKIE`) |
| `AGENT_SESSION_COOKIE` | рекомендуется | Готовая сессионная cookie агента (`PHPSESSID=...`) — продакшен-путь без пароля в env |
| `HOSTGTA_BASE_URL` | — | По умолчанию `https://hostgta.ru` |
| `AGENT_PROXY_URL` | опц. | Прокси для запросов агента (если HostGta банит IP сервера) |
| `TOKEN_SECRET` | ✅ | HMAC-секрет токенов доступа к дашборду |
| `CRON_SECRET` | ✅ | Секрет защиты эндпоинта `/api/cron/monitor` |
| `MONITOR_INTERVAL_MIN` | — | Интервал фонового мониторинга (по умолчанию 60 мин) |
| `SERVER_ID` | — | ID сервера на HostGta (`default` = основной) |

---

## 1. Vercel (рекомендуемый способ)

```bash
npm i -g vercel
vercel link
vercel env add AGENT_SESSION_COOKIE production
vercel env add TOKEN_SECRET production
vercel env add CRON_SECRET production
vercel --prod
```

- `vercel.json` уже содержит **Vercel Cron** `0 * * * *` → `GET /api/cron/monitor`
  (Vercel автоматически подставляет `Authorization: Bearer $CRON_SECRET`).
- Все API-роуты работают на Node.js runtime; Puppeteer нет → лимитов bundle-size нет.
- ⚠️ На тарифе Hobby cron доступен только раз в сутки. Для цикла «каждые 60 минут»
  используйте внешний планировщик (см. п. 3).

## 2. Tatnet / Onreza / Layer0 / любой VPS (Docker)

```bash
docker build -t bothostgtagame .
docker run -d --name bothostgtagame \
  -p 3000:3000 \
  -e AGENT_LOGIN=agent@example.com \
  -e AGENT_PASSWORD=... \
  -e AGENT_SESSION_COOKIE="PHPSESSID=..." \
  -e TOKEN_SECRET=... -e CRON_SECRET=... \
  --restart unless-stopped bothostgtagame
```

Фоновый мониторинг каждые 60 минут через системный crontab:

```cron
0 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://your-domain.ru/api/cron/monitor
```

## 3. Внешний планировщик (для serverless без hourly-cron)

Любой uptime-сервис (cron-job.org, UptimeRobot, Keila) с расписания `0 * * * *`:

```
GET https://your-domain.ru/api/cron/monitor
Authorization: Bearer <CRON_SECRET>
```

## 4. Локальная разработка

```bash
git clone https://github.com/<you>/bothostgtagame && cd bothostgtagame
npm install
cp .env.example .env.local   # заполните AGENT_* значениями
npm run dev                  # http://localhost:3000
```

---

## Обход Cloudflare / антиботов (без эмуляции браузера)

HostGta может стоять за Cloudflare. Так как мы сознательно **не используем
эмуляцию браузера**, применяется стек «честных» HTTP-мер:

1. **Сессионная cookie вместо пароля.** Залогиньтесь агентом один раз в обычном
   браузере, скопируйте куку (`PHPSESSID`/аналог) из DevTools → Network в
   `AGENT_SESSION_COOKIE`. Челлендж CF при логине проходит человек, а бот живёт
   уже с валидной `cf_clearance`+сессией.
2. **Минимальные, консистентные заголовки.** `lib/agent.ts` отправляет стабильный
   `User-Agent`, `Origin`, `Referer` и переиспользует cookie-jar — поведение похоже
   на обычный XHR фронтенда HostGta, а не на хаотичный скрейпер.
3. **Прокси.** Если IP вашего хостера в бане/под rate-limit — задайте
   `AGENT_PROXY_URL` (резидентный прокси от проверенного провайдера).
4. **Низкая частота.** Мониторинг — 1 проверка в 60 минут на пользователя;
   верификация Friend Key защищена rate-limiter'ом на нашей стороне.
5. **Если ничего не помогло:** это сигнал, что HostGta ужесточил защиту, —
   обратитесь к администрации хостинга за официальным API/токеном.

> ⚠️ Правовая заметка: автоматизация действий от имени аккаунта возможна только
> для аккаунта, которым вы владеете (агент), и не должна нарушать ToS HostGta.
> При изменении политики хостинга форк обязан добавить флаг согласия пользователя.
