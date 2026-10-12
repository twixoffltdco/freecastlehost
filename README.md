# bothostgtagame v2.0 — Castle Host Automation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933)
![Playwright](https://img.shields.io/badge/Playwright-core-blue)

**Приватный инструмент для автоматического управления МОИМ ЛИЧНЫМ аккаунтом
на хостинге [Castle Host](https://cp.castle-host.com).**

Старый хостинг **HostGta больше не используется** — вся логика парсинга
переработана под панель Castle Host (v1.0 привилегированного режима).

## Что делает бот

| Задача | Расписание (МСК) | Логика |
|---|---|---|
| 🟢 Включение сервера | ежедневно в **00:01** (`START_CRON`) | сервер гаснет в 00:00 МСК → бот проверяет статус и эмулирует клик **«Включить сервер»** |
| 🔁 Почасовой чек | каждый час (`CHECK_CRON`) | проверка статуса + страховочное включение в ночном окне 00:01–00:59 |
| 💳 Продление аренды | при остатке **< 24 часов** (`RENEW_THRESHOLD_HOURS`) | клик **«Продлить на 7 дней»** → выбор периода → **оплата с баланса аккаунта** → подтверждение |
| 🔁 Retry | через **5 минут** (`RETRY_AFTER_MIN`), до 3 попыток | если включение/оплата не прошли |
| 📬 Уведомления | Telegram Bot API и/или простой webhook | все включения, оплаты и ошибки; дублируются в `logs/bot.log` |
| 🧍 Human-like | всегда | случайные задержки 0.8–3.5 с между действиями, посимвольный ввод, «живой» курсор |

## Архитектура

```
node-cron (TZ=Europe/Moscow)
   │  bot/index.js — планировщик, singleton-защита
   ▼
bot/tasks.js ─── withRetry (5 мин × 3) ──► bot/notify.js (Telegram / webhook)
   │
   ▼
bot/auth.js ─── persistent-сессия (session/) ──► bot/castle.js (старт/продление/парсинг)
   │                                              ▲
   └── Playwright (chromium, headless)            └── bot/selectors.js — карта панели
```

- **Playwright вместо Puppeteer** — стабильнее при редизайнах панелей и лучше
  переносит ожидание/авто-wait. Используется `playwright-core` + системный Chrome.
- **Устойчивые селекторы**: каждый элемент описан списком вариантов
  (`data-*`, `aria-*`, текст кнопки → и только потом CSS-классы). Функция
  `firstMatching()` перебирает их и берёт первый реально найденный — панель
  может менять классы, бот продолжит работать.
- **Сессия живёт в persistent-профиле браузера** (`SESSION_DIR`, исключён из Git).
  Cookies — это не localStorage страницы и никогда не содержат пароль.

## ⚠️ SECURITY WARNING: Never commit your credentials!

> **НИКОГДА не коммитьте реальные пароли в Git!**
>
> - Все учётные данные берутся **ТОЛЬКО** из файла `.env.local`.
> - В коде нет ни одного хардкод-пароля; в браузер/UI секреты не передаются.
> - `.gitignore` блокирует любые файлы `.env*` (кроме шаблона `.env.example`).
> - Папки `session/` (cookies!), `logs/` и `screenshots/` также вне Git.
> - Пароль не пишется в логи и уведомления — там только статусы действий.
> - Перед push проверьте: `git status --ignored | grep .env` — реального `.env.local`
>   быть в списке отслеживаемых файлов не должно.

## Быстрый старт

### 1. Настройка секретов

**Создайте `.env.local` по шаблону `.env.example`. Никогда не коммитьте реальные
пароли в Git!**

```bash
cp .env.example .env.local
nano .env.local   # заполните CASTLE_LOGIN, CASTLE_PASSWORD, CASTLE_SERVER_ID
```

Обязательные переменные:

| Переменная | Описание |
|---|---|
| `CASTLE_LOGIN` | e-mail/логин вашего аккаунта Castle Host |
| `CASTLE_PASSWORD` | пароль (только в `.env.local`!) |
| `CASTLE_SERVER_ID` | ID сервера (виден в URL: `cp.castle-host.com/servers/<ID>`) |

Необязательные: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (уведомления),
`WEBHOOK_URL`, `CAPTCHA_23_CAPTCHA_KEY` (решатель капчи), `CHROME_PATH`,
значения расписания и антибан-задержек — см. комментарии в `.env.example`.

### 2. Установка

```bash
npm install

# Браузер: playwright-core использует системный Chrome/Chromium
# Debian/Ubuntu:
sudo apt install -y chromium || sudo apt install -y google-chrome-stable
# macOS:
brew install --cask google-chrome
# Windows: укажите путь через CHROME_PATH в .env.local
```

### 3. Первичный вход (прохождение капчи/2FA один раз)

```bash
HEADLESS=false npm run login:once
```

Откроется окно браузера: бот залогинится сам; если панель покажет капчу —
пройдите её мышкой. Сессия сохранится в `./session/` и дальнейшие запуски
будут **headless, без ввода пароля** (по cookies).

### 4. Запуск планировщика

```bash
npm start                 # node-cron: включение в 00:01 МСК + почасовой чек
npm run check:once        # разовая отладочная проверка цикла
```

### 5. Автозапуск на VPS (systemd)

```ini
# /etc/systemd/system/bothostgtagame.service
[Unit]
Description=Castle Host server autostart bot
After=network-online.target

[Service]
WorkingDirectory=/opt/bothostgtagame
ExecStart=/usr/bin/node bot/index.js
Restart=always
RestartSec=60
EnvironmentFile=/opt/bothostgtagame/.env.local

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now bothostgtagame
journalctl -u bothostgtagame -f
```

Альтернатива без демона — системный crontab (секретов в crontab не храните,
.env.local подхватится сам):

```cron
1 0 * * *  cd /opt/bothostgtagame && node bot/check-once.js >> logs/cron.log 2>&1
```

## Структура проекта

```
bot/
├── index.js       # точка входа: node-cron планировщик (00:01 МСК + hourly)
├── config.js      # чтение ВСЕХ настроек из .env.local (dotenv), валидация
├── timezone.js    # точное время Europe/Moscow через Intl (не зависит от TZ хоста)
├── browser.js     # Playwright persistent-контекст + human-delay/type/click + скриншоты
├── auth.js        # вход: сессия → форма → капча (2captcha или вручную)
├── castle.js      # статус сервера, «Включить», дата аренды, «Продлить+оплата с баланса»
├── selectors.js   # ★ карта панели: устойчивые селекторы (data-*, aria-*, текст)
├── tasks.js       # бизнес-циклы dailyStart/hourlyCheck + retry каждые 5 минут
├── logger.js      # консоль + logs/bot.log (без секретов)
├── notify.js      # Telegram Bot API / webhook
├── login-once.js  # интерактивный одноразовый вход (капча мышкой)
└── check-once.js  # разовый цикл проверки для отладки/crontab
.env.example       # шаблон настроек (заглушки, БЕЗ реальных паролей)
.gitignore         # блокирует .env*, session/, logs/, screenshots/
```

## Если панель изменит вёрстку

1. Запустите `npm run check:once` с `LOG_LEVEL=debug` — посмотрите `logs/bot.log`
   и `screenshots/*.png` (бот сохраняет кадр при каждом unfound-сценарии).
2. Откройте соответствующий блок в `bot/selectors.js` и добавьте новый вариант
   селектора **в начало** списка (старые варианты оставьте как фолбэк).
3. Бизнес-логику (`castle.js`, `tasks.js`) править не нужно — она работает со
   списком вариантов через `firstMatching()`.

## Капча

- При появлении reCAPTCHA/hCaptcha на входе бот пытается решить её через
  сервис 2captcha (нужен `CAPTCHA_23_CAPTCHA_KEY`).
- Без решателя: сохраняется скриншот + уведомление; выполните шаг 3 ещё раз
  в видимом окне (`HEADLESS=false npm run login:once`) — сессия снова сохранится.

## Лицензия и дисклеймер

[MIT](LICENSE). Проект **не аффилирован с Castle Host**. Инструмент предназначен
для автоматизации **вашего собственного** аккаунта; убедитесь, что автоматизация
панели не нарушает правила хостинга. Ответственность за инстанс несёт администратор.
