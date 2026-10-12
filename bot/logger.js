/**
 * bot/logger.js — логирование всех действий бота.
 * Пишет в консоль и в файл logs/bot.log. Секреты в логи не попадают —
 * уровень детализации DEBUG включает только технические сообщения.
 */
import fs from 'node:fs';
import path from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };

let threshold = LEVELS.info;
let stream = null;

export function initLogger({ logLevel = 'info', logDir = 'logs' } = {}) {
  threshold = LEVELS[logLevel] ?? LEVELS.info;
  fs.mkdirSync(logDir, { recursive: true });
  stream = fs.createWriteStream(path.join(logDir, 'bot.log'), { flags: 'a' });
}

export function setLogLevel(level) {
  if (LEVELS[level] !== undefined) threshold = LEVELS[level];
}

function write(level, msg, extra) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  console.log(`${COLORS[level]}${line}\x1b[0m` + (extra ? ` ${JSON.stringify(extra)}` : ''));
  if (stream) stream.write(line + (extra ? ` ${JSON.stringify(extra)}` : '') + '\n');
}

export const log = {
  debug: (m, e) => write('debug', m, e),
  info: (m, e) => write('info', m, e),
  warn: (m, e) => write('warn', m, e),
  error: (m, e) => write('error', m, e),
};
