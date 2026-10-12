'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, LogOut, RefreshCw, Server, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useSessionStore } from '@/store/useSessionStore';
import type { ServerStatusResult, MonitorLogEntry } from '@/lib/types';

/** Интервал автообновления статуса в дашборде (60 секунд UI-проверка; серверный cron — 60 минут). */
const UI_POLL_MS = 60_000;

/**
 * components/ServerDashboard.tsx — панель мониторинга сервера 24/7.
 * Показывает статус, uptime, время последнего чека и историю; умеет запускать проверку вручную.
 */
export function ServerDashboard() {
  const { userId, accessToken, logout } = useSessionStore();
  const [result, setResult] = useState<ServerStatusResult | null>(null);
  const [history, setHistory] = useState<MonitorLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Один цикл проверки статуса через /api/check-server-status. */
  const checkStatus = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch('/api/check-server-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (res.status === 401) {
        // Токен протух/подделан — разворачиваем на перевсификацию.
        logout();
        window.location.href = '/';
        return;
      }
      const data = (await res.json()) as ServerStatusResult;
      setResult(data);
      setHistory((h) => [{ at: data.checkedAt, status: data.status, autoRestarted: data.autoRestarted }, ...h].slice(0, 20));
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, logout]);

  // Автоопрос каждые 60 секунд, пока пользователь на странице.
  useEffect(() => {
    checkStatus();
    timerRef.current = setInterval(checkStatus, UI_POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkStatus]);

  const statusBadge = () => {
    switch (result?.status) {
      case 'online':
        return <Badge variant="success">● Online</Badge>;
      case 'offline':
        return <Badge variant="destructive">● Offline</Badge>;
      case 'maintenance':
        return <Badge variant="muted">● Техработы</Badge>;
      default:
        return <Badge variant="muted">● Нет данных</Badge>;
    }
  };

  /** Форматирует uptime из мс в «дн чч:мм». */
  const formatUptime = (ms: number | null | undefined) => {
    if (ms == null || ms <= 0) return '—';
    const d = Math.floor(ms / 86_400_000);
    const h = Math.floor((ms % 86_400_000) / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return (d > 0 ? `${d}д ` : '') + `${h}ч ${String(m).padStart(2, '0')}м`;
  };

  return (
    <div className="w-full max-w-2xl space-y-4">
      {/* Шапка дашборда */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Server className="h-5 w-5" /> Панель управления
          </h1>
          <p className="text-sm text-muted-foreground">ID пользователя: {userId ?? '—'}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            logout();
            window.location.href = '/';
          }}
        >
          <LogOut className="h-4 w-4" /> Выйти
        </Button>
      </div>

      {/* Карточка статуса */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Статус сервера
          </CardTitle>
          <CardDescription>Фоновый мониторинг выполняется каждые 60 минут (cron).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {statusBadge()}
            {result?.autoRestarted && <Badge variant="outline">🔄 Выполнен автозапуск</Badge>}
            {loading && <Spinner className="text-muted-foreground" />}
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Uptime</p>
              <p className="font-mono">{formatUptime(result?.uptimeMs)}</p>
            </div>
            <div>
              <p className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> Последний чек
              </p>
              <p className="font-mono">{result ? new Date(result.checkedAt).toLocaleString('ru-RU') : '—'}</p>
            </div>
          </div>

          {result?.message && <p className="text-sm text-muted-foreground">{result.message}</p>}

          <Button variant="secondary" size="sm" onClick={checkStatus} disabled={loading}>
            <RefreshCw className="h-4 w-4" /> Проверить сейчас
          </Button>
        </CardContent>
      </Card>

      {/* История проверок */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Журнал мониторинга</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока пусто.</p>
          ) : (
            <ul className="space-y-1 font-mono text-xs text-muted-foreground">
              {history.map((h, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className={h.status === 'online' ? 'text-emerald-400' : h.status === 'offline' ? 'text-red-400' : ''}>
                    {h.status}
                  </span>
                  <span>{new Date(h.at).toLocaleTimeString('ru-RU')}</span>
                  {h.autoRestarted && <span className="text-amber-400">(автозапуск)</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
