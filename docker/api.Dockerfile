# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# @starter/api — multi-stage build with frozen lockfile and compiled workspace
# packages. Runtime image contains only the pruned production bundle (pnpm deploy).
# ---------------------------------------------------------------------------
ARG NODE_IMAGE=node:24.22.1-trixie-slim

# Optional corporate proxy support: pass HTTP(S)_PROXY build args and an extra CA bundle with
#   --secret id=extra_ca,src=/path/to/ca.pem   (never baked into any image layer)
FROM ${NODE_IMAGE} AS build
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca npm_config_cafile=/run/secrets/extra_ca; fi; \
    npm install -g pnpm@12.15.0 && mkdir -p /pnpm
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca npm_config_cafile=/run/secrets/extra_ca SSL_CERT_FILE=/run/secrets/extra_ca; fi; \
    pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --offline --ignore-scripts \
 && pnpm exec tsc -b tsconfig.json
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca npm_config_cafile=/run/secrets/extra_ca SSL_CERT_FILE=/run/secrets/extra_ca; fi; \
    pnpm --filter @starter/api deploy --prod --frozen-lockfile --ignore-scripts /out && cp starter.manifest.json /out/

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production STORAGE_LOCAL_DIR=/data/storage
WORKDIR /app
RUN mkdir -p /data/storage && chown -R node:node /data
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
