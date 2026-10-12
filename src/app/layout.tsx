import type { Metadata } from 'next';
import './globals.css';

/** Метаданные приложения (SEO). */
export const metadata: Metadata = {
  title: 'bothostgtagame — управление сервером HostGta',
  description:
    'Open Source веб-инструмент для автоматического мониторинга и управления игровыми серверами на хостинге HostGta.ru',
  keywords: ['hostgta', 'samp', 'gtamp', 'бот', 'мониторинг сервера', 'open source'],
};

/**
 * app/layout.tsx — корневой layout. Dark Mode включён по умолчанию (класс `dark`),
 * вёрстка адаптивная, мобильный-first.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {/* Тонкая фоновая сетка для «геймерского» минимализма */}
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.08),transparent_60%)]" />
        <main className="flex min-h-screen flex-col items-center justify-center p-4 sm:p-8">{children}</main>
        <footer className="pb-4 text-center text-xs text-muted-foreground">
          bothostgtagame · MIT License ·{' '}
          <a href="https://github.com/your-org/bothostgtagame" className="underline-offset-4 hover:underline" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </footer>
      </body>
    </html>
  );
}
