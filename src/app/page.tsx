'use client';

import { useEffect } from 'react';
import { Gamepad2 } from 'lucide-react';
import { FriendKeyPanel } from '@/components/FriendKeyPanel';
import { useSessionStore } from '@/store/useSessionStore';

/**
 * app/page.tsx — главная страница: генерация Friend Key и верификация.
 * Если пользователь уже верифицирован (есть токен в localStorage) — редирект на дашборд.
 */
export default function HomePage() {
  const accessToken = useSessionStore((s) => s.accessToken);

  useEffect(() => {
    if (accessToken) window.location.href = '/dashboard';
  }, [accessToken]);

  return (
    <div className="flex w-full flex-col items-center gap-8">
      {/* Логотип / заголовок */}
      <header className="text-center">
        <div className="mb-3 inline-flex items-center justify-center rounded-2xl bg-primary/10 p-3">
          <Gamepad2 className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          bothost<span className="text-primary">gtagame</span>
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Автоматический мониторинг и управление вашим сервером на HostGta.ru.
          Подтвердите владение сервером через Friend Key — и бот будет держать его онлайн 24/7.
        </p>
      </header>

      {/* Основная панель */}
      <FriendKeyPanel />
    </div>
  );
}
