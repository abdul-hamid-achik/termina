# ── Termina WS + game server (DigitalOcean) ───────────────────────
# Full Nitro server: SSR + WS + game engine + API. The Vercel frontend
# connects to this instance via NUXT_PUBLIC_WS_URL / NUXT_PUBLIC_API_URL.

# Bun-based build for speed; the runtime is Node (Nitro's .output/server
# is a Node-compatible ESM bundle).
FROM oven/bun:1 AS build
WORKDIR /app

# Install dependencies first (cached layer).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy the rest and build the Nitro server.
COPY . .
RUN bun run build

# ── Runtime ───────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app

# Nitro's server output is self-contained — just copy .output (owned by the
# non-root runtime user so it's readable after the USER switch below).
COPY --from=build --chown=node:node /app/.output ./.output

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

# Drop root: node:22-slim ships a built-in unprivileged `node` user. The server
# binds 3000 (>1024) and writes nothing to the app dir at runtime (all state
# lives in Redis/Postgres), so it runs fine unprivileged. Standard hardening.
USER node

# Liveness/readiness probe: hit the Nitro /api/health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]