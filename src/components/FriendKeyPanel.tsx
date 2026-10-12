'use client';

import { useState } from 'react';
import { Check, Copy, KeyRound, RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { useSessionStore } from '@/store/useSessionStore';
import type { VerifyFriendResult } from '@/lib/types';

/**
 * components/FriendKeyPanel.tsx — главная панель: генерация Friend Key,
 * инструкция и кнопка «Проверить подключение» (запрос к /api/verify-friend).
 */
export function FriendKeyPanel() {
  const {
    friendKey,
    verifyState,
    lastError,
    generateKey,
    setVerifyState,
    setVerified,
  } = useSessionStore();

  const [copied, setCopied] = useState(false);

  /** Копирование ключа в буфер обмена. */
  async function copyKey() {
    if (!friendKey) return;
    await navigator.clipboard.writeText(friendKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  /** Запуск проверки заявки на HostGta через backend API. */
  async function checkConnection() {
    if (!friendKey) return;
    setVerifyState('checking');
    try {
      const res = await fetch('/api/verify-friend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: friendKey }),
      });
      const data = (await res.json()) as VerifyFriendResult & { error?: string };

      if (res.ok && data.found && data.userId && data.accessToken) {
        // Успех: сохраняем ID пользователя и токен в localStorage, открываем дашборд.
        setVerified(data.userId, data.accessToken);
        window.location.href = '/dashboard';
      } else {
        setVerifyState('error', data.message ?? 'Бот не нашел заявку. Проверьте правильность ключа и попробуйте снова.');
      }
    } catch {
      setVerifyState('error', 'Сервер недоступен. Попробуйте повторить проверку позже.');
    }
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <KeyRound className="h-5 w-5" /> Friend Key
        </CardTitle>
        <CardDescription>
          Сгенерируйте ключ, добавьте бота в друзья на HostGta.ru и укажите ключ в сообщении заявки.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Шаг 1 — генерация */}
        {!friendKey ? (
          <Button onClick={() => generateKey()} className="w-full">
            Сгенерировать ключ
          </Button>
        ) : (
          <>
            {/* Ключ + копирование */}
            <div className="flex items-stretch gap-2">
              <code className="flex-1 select-all break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
                {friendKey}
              </code>
              <Button variant="outline" size="icon" onClick={copyKey} aria-label="Скопировать ключ">
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>

            {/* Инструкция */}
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                Скопируйте ключ и откройте{' '}
                <a
                  href="https://hostgta.ru"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  hostgta.ru <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>Найдите аккаунт бота и добавьте его в друзья.</li>
              <li>В сообщении заявки укажите ваш ключ (одной строкой).</li>
            </ol>

            {/* Шаг 2 — проверка */}
            <div className="flex flex-col gap-3 pt-1">
              <Button onClick={checkConnection} disabled={verifyState === 'checking'} className="w-full">
                {verifyState === 'checking' ? (
                  <>
                    <Spinner /> Проверяем подключение…
                  </>
                ) : verifyState === 'error' ? (
                  <>
                    <RefreshCw className="h-4 w-4" /> Повторить проверку
                  </>
                ) : (
                  'Проверить подключение'
                )}
              </Button>

              {/* Статусы */}
              {verifyState === 'error' && lastError && (
                <Badge variant="destructive" className="justify-start whitespace-normal py-2">
                  ⚠ {lastError}
                </Badge>
              )}
              {verifyState === 'success' && (
                <Badge variant="success">Успех! Панель управления открыта.</Badge>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
