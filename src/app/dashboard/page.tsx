'use client';

import { useEffect, useState } from 'react';
import { ServerDashboard } from '@/components/ServerDashboard';
import { Spinner } from '@/components/ui/spinner';
import { useSessionStore } from '@/store/useSessionStore';

/**
 * app/dashboard/page.tsx — защищённая страница мониторинга.
 * Доступ возможен только после успешной верификации Friend Key:
 * проверяем наличие токена в localStorage; при его отсутствии — на главную.
 * (Реальная проверка подписи токена выполняется на сервере в API-роутах.)
 */
export default function DashboardPage() {
  const accessToken = useSessionStore((s) => s.accessToken);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (hydrated && !accessToken) window.location.href = '/';
  }, [hydrated, accessToken]);

  // До гидрации zustand persist и без токена показываем лоадер (избегаем flash).
  if (!hydrated || !accessToken) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Spinner /> Загружаем панель…
      </div>
    );
  }

  return <ServerDashboard />;
}
