'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { generateFriendKey } from '@/lib/crypto';

/**
 * store/useSessionStore.ts — Zustand-хранилище клиентской сессии.
 * Персистится в localStorage: при перезагрузке страницы ключ и ID пользователя
 * сохраняются; при очистке кеша браузера — теряются (см. README, раздел «Хранение состояния»).
 */

export type VerifyState = 'idle' | 'checking' | 'success' | 'error';

interface SessionState {
  friendKey: string | null;
  userId: string | null;
  accessToken: string | null;
  verifyState: VerifyState;
  lastError: string | null;

  /** Генерирует новый Friend Key и сохраняет его. */
  generateKey: () => string;
  setVerifyState: (s: VerifyState, error?: string | null) => void;
  /** Сохраняет результат успешной верификации (ID + токен доступа). */
  setVerified: (userId: string, accessToken: string) => void;
  /** Полный сброс (кнопка «Выйти»). */
  logout: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      friendKey: null,
      userId: null,
      accessToken: null,
      verifyState: 'idle',
      lastError: null,

      generateKey: () => {
        const key = generateFriendKey(); // криптографически стойный hex-код
        set({ friendKey: key, verifyState: 'idle', lastError: null });
        return key;
      },

      setVerifyState: (s, error = null) => set({ verifyState: s, lastError: error }),

      setVerified: (userId, accessToken) =>
        set({ userId, accessToken, verifyState: 'success', lastError: null }),

      logout: () =>
        set({ friendKey: null, userId: null, accessToken: null, verifyState: 'idle', lastError: null }),
    }),
    {
      name: 'bothostgtga-session', // ключ в localStorage
      storage: createJSONStorage(() => localStorage),
      // В персистентное хранилище кладём только данные сессии, не UI-статусы.
      partialize: (state) => ({
        friendKey: state.friendKey,
        userId: state.userId,
        accessToken: state.accessToken,
      }),
    },
  ),
);
