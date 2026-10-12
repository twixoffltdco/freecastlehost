# syntax=docker/dockerfile:1
# ============================================================
# bothostgtagame — Docker-образ для деплоя на Tatnet / Onreza / Layer0 / любой VPS.
# Использует режим next.config.mjs → output: 'standalone' (минимальный артефакт сборки).
# Puppeteer не требуется: продакшен-клиент работает на fetch (см. src/lib/agent.ts).
# ============================================================

# ---------- Стадия сборки ----------
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---------- Стадия рантайма ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Непривилегированный пользователь (безопасность).
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# Копируем только standalone-артефакт + статические файлы.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Эмуляция браузера не используется (user=agent, чистый HTTP). Chromium не нужен.

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
