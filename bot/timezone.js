/**
 * bot/timezone.js — точное московское время без внешних зависимостей.
 * Использует Intl API, поэтому не зависит от TZ-настройки хоста
 * (актуально даже при переходе на VPS за пределами РФ).
 */

const MSK_FMT = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

/** Разбивает форматированную строку Intl на компоненты времени в мс (epoch). */
function partsToEpoch(date) {
  const parts = {};
  for (const p of MSK_FMT.formatToParts(date)) parts[p.type] = p.value;
  // Эпоха «как если бы»Components были UTC — это и есть смещение локального времени.
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
}

/** Смещение Europe/Moscow относительно UTC в миллисекундах (исторически +3:00). */
export function mskOffsetMs(now = new Date()) {
  return partsToEpoch(now) - Math.floor(now.getTime() / 1000) * 1000;
}

/** Текущее московское время как Date (epoch тот же, поля getHours/getMinutes — МСК). */
export function nowMoscow() {
  const now = new Date();
  return new Date(now.getTime() + mskOffsetMs(now));
}

/**
 * «Окно включения»: 00:00–00:59 МСК. Сервер гаснет в 00:00 МСК,
 * бот поднимает его в 00:01; окно в один час — страховка, если бот
 * был недоступен ровно в 00:01 (рестарт, капча, сетевой сбой).
 */
export function isStartWindowMoscow(d = nowMoscow()) {
  return d.getHours() === 0 && d.getMinutes() >= 1;
}

/** Отформатированное время МСК для логов/уведомлений. */
export function formatMoscow(d = new Date()) {
  return `${MSK_FMT.format(d)} МСК`;
}
