/**
 * Конфигурация Next.js для bothostgtagame.
 * output: 'standalone' — критично для деплоя на Tatnet/Onreza/Layer0 (Docker),
 * позволяет собирать минимальный self-contained образ без node_modules целиком.
 * На Vercel эта настройка игнорируется (Vercel использует свой сборщик).
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // Никаких нативных/браузерных внешних пакетов: продакшен-клиент HostGta
  // (lib/agent.ts) работает на чистом fetch — сборка лёгкая и переносимая.

  // Безопасность: запрещаем iframe-встраивание нашего UI сторонними сайтами.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
