# ── Termina WS + game server (DigitalOcean) ───────────────────────
# Full Nitro server: SSR + WS + game engine + API. The Vercel frontend connects
# to this instance via NUXT_PUBLIC_WS_URL / NUXT_PUBLIC_API_URL.
#
# We deliberately do NOT build inside Docker. A multi-stage in-image build
# (`bun install` + `nuxt build`) made BuildKit HANG on export of the huge
# build-stage layer — both locally and on GitHub runners (build finished in ~26s,
# then the export wedged until the job timeout). Instead CI builds the Nitro
# `.output` natively (`bun run build`, ~1-2 min) and this image just PACKAGES it:
# .output is a self-contained Node ESM bundle (its own node_modules), so the
# whole image is one tiny COPY — fast to build, tiny to push, nothing to wedge.
FROM node:24-slim
WORKDIR /app

# Pre-built in CI; owned by the non-root runtime user so it's readable post-USER.
COPY --chown=node:node .output ./.output

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

# Drop root: node:24-slim ships a built-in unprivileged `node` user. The server
# binds 3000 (>1024) and writes nothing to the app dir at runtime (all state
# lives in Redis/Postgres), so it runs fine unprivileged. Standard hardening.
USER node

# Liveness/readiness probe: hit the Nitro /api/health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
