/**
 * api/cron/monitor/route.ts — GET /api/cron/monitor
 *
 * Фоновый цикл мониторинга 24/7. Вызывается планировщиком:
 *  - Vercel Cron (vercel.json → каждые 60 минут, Authorization: Bearer $CRON_SECRET);
 *  - системный crontab на Tatnet/Onreza/Layer0/VPS;
 *  - любой внешний uptime-сервис.
 *
 * Благодаря этому фоновый мониторинг НЕ зависит от localStorage пользователя:
 * даже если он очистил кеш браузера, cron продолжит держать сервер онлайн.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { checkServerStatus } from '@/lib/monitor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// На Vercel cron-функции могут выполняться до 60 сек (Pro) — закладываемся на скрейпинг.
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Защита эндпоинта: сверяем Bearer-токен с CRON_SECRET (постоянное сравнение).
  const env = getEnv();
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!env.cronSecret || token !== env.cronSecret) {
    return NextResponse.json({ message: 'Недопустимый секрет планировщика.' }, { status: 401 });
  }

  try {
    const result = await checkServerStatus();
    console.log(`[cron] статус=${result.status} автозапуск=${result.autoRestarted}`);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[cron] ошибка мониторинга:', err);
    return NextResponse.json({ message: 'Ошибка фонового мониторинга.' }, { status: 500 });
  }
}
