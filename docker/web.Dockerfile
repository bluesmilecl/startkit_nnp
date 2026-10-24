# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# @starter/web — Nuxt 4 compiled with Nitro (node-server preset). The runtime image
# only contains .output (self-contained server with traced dependencies).
# ---------------------------------------------------------------------------
ARG NODE_IMAGE=node:24.22.1-trixie-slim

# Optional corporate proxy support: pass HTTP(S)_PROXY build args and an extra CA bundle with
#   --secret id=extra_ca,src=/path/to/ca.pem   (never baked into any image layer)
FROM ${NODE_IMAGE} AS build
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH NUXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca npm_config_cafile=/run/secrets/extra_ca; fi; \
    npm install -g pnpm@12.15.0 && mkdir -p /pnpm
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca npm_config_cafile=/run/secrets/extra_ca SSL_CERT_FILE=/run/secrets/extra_ca; fi; \
    pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --offline \
 && pnpm exec tsc -b tsconfig.json \
 && pnpm --filter @starter/web build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 NUXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]
