/**
 * api/check-server-status/route.ts — POST /api/check-server-status
 *
 * Точка мониторинга сервера: проверяет статус на hostgta.ru/servers и,
 * если сервер Offline, автоматически отправляет POST «включить».
 *
 * Доступ: только с валидным Bearer-токеном, выданным после верификации Friend Key.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/crypto';
import { checkServerStatus } from '@/lib/monitor';
import { rateLimit, clientKeyFromHeaders } from '@/lib/rate-limit';

export const runtime = 'nodejs'; // запросы к HostGta + парсинг требуют Node runtime
export const dynamic = 'force-dynamic';

/** Секрет подписи токенов (должен совпадать с тем, что использует /api/verify-friend). */
function tokenSecret(): string {
  return process.env.TOKEN_SECRET ?? process.env.CRON_SECRET ?? 'dev-only-insecure-secret';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Rate limiting: мониторинг — недешёвая операция.
  const limit = rateLimit(`status:${clientKeyFromHeaders(req.headers)}`, undefined, 30);
  if (!limit.ok) {
    return NextResponse.json(
      { message: `Слишком частые проверки. Повторите через ${limit.retryAfterSec} сек.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  // 2. Аутентификация по HMAC-токену из localStorage клиента.
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = token ? await verifyAccessToken(token, tokenSecret()) : null;
  if (!payload) {
    return NextResponse.json({ message: 'Токен доступа отсутствует или недействителен. Пройдите верификацию заново.' }, { status: 401 });
  }

  // 3. Проверка статуса + автозапуск при Offline (логика в lib/monitor.ts).
  try {
    const result = await checkServerStatus();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[check-server-status] ошибка:', err);
    return NextResponse.json({ message: 'Внутренняя ошибка при проверке статуса.' }, { status: 500 });
  }
}

/** GET — лёгкий «health» вариант для внешних uptime-проверок (без авторизации, без действий). */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, service: 'bothostgtagame', endpoint: '/api/check-server-status' });
}
