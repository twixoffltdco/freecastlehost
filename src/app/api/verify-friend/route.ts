/**
 * api/verify-friend/route.ts — POST /api/verify-friend
 *
 * Проверяет, появилась ли заявка в друзья с указанным Friend Key на аккаунте агента HostGta.
 * ПРОДАКШЕН (user = agent): запрос идёт напрямую на HTTP-API HostGta через
 * AgentSession (lib/agent.ts) — без эмуляции браузера и без headless-Chrome.
 *
 * При успехе генерируется HMAC-подписанный токен доступа к дашборду.
 * Секреты агента никогда не покидают сервер.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEnv, isHostgtaConfigured } from '@/lib/env';
import { findFriendKey, sanitizeKey } from '@/lib/hostgta';
import { createAccessToken } from '@/lib/crypto';
import { rateLimit, clientKeyFromHeaders } from '@/lib/rate-limit';
import type { VerifyFriendResult } from '@/lib/types';

// Проверка требует реального запроса к сайту — Node.js runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Секрет подписи токенов: env или dev-заглушка (только для локальной разработки!). */
function tokenSecret(): string {
  return process.env.TOKEN_SECRET ?? process.env.CRON_SECRET ?? 'dev-only-insecure-secret';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Rate limiting по IP (защита от перебора ключей и DDoS на скрейпер).
  const limit = rateLimit(`verify:${clientKeyFromHeaders(req.headers)}`, undefined, 10);
  if (!limit.ok) {
    return NextResponse.json(
      { found: false, message: `Слишком много попыток. Повторите через ${limit.retryAfterSec} сек.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  // 2. Валидация входных данных (строгий whitelist-паттерн, см. sanitizeKey).
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ found: false, message: 'Некорректный JSON-запрос.' }, { status: 400 });
  }
  const rawKey = (body as { key?: unknown })?.key;
  const key = sanitizeKey(rawKey);
  if (!key) {
    return NextResponse.json(
      { found: false, message: 'Бот не нашел заявку. Проверьте правильность ключа и попробуйте снова.' },
      { status: 400 },
    );
  }

  const env = getEnv();
  if (!isHostgtaConfigured(env)) {
    return NextResponse.json(
      { found: false, message: 'Сервер не настроен: администратор должен заполнить данные агента в .env' },
      { status: 503 },
    );
  }

  // 3. Собственно проверка заявки на HostGta (прямой HTTP от имени агента).
  try {
    const result = await findFriendKey(key);

    if (result.found && result.userId) {
      // 4. Успех: выдаём подписанный токен доступа к дашборду (7 дней).
      const accessToken = await createAccessToken(result.userId, key, tokenSecret());
      const payload: VerifyFriendResult = {
        found: true,
        userId: result.userId,
        accessToken,
        message: 'Успех! Заявка найдена, доступ к панели управления открыт.',
      };
      return NextResponse.json(payload);
    }

    // 5. Ключ не найден — текст ошибки строго по ТЗ + возможность повторить проверку.
    const payload: VerifyFriendResult = {
      found: false,
      message: 'Бот не нашел заявку. Проверьте правильность ключа и попробуйте снова.',
    };
    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    console.error('[verify-friend] ошибка:', err);
    return NextResponse.json(
      {
        found: false,
        message: 'Не удалось проверить заявку (Cloudflare/таймаут). Нажмите «Повторить проверку» чуть позже.',
      },
      { status: 502 },
    );
  }
}
