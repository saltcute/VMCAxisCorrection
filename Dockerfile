# syntax=docker/dockerfile:1

# ---- build: compile shared, web (Vite) and bridge (tsc) ----
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/bridge/package.json packages/bridge/
COPY packages/web/package.json packages/web/
# Optional deps stay on: Vite's native bundler bindings are optional deps. uiohook-napi may fail
# to build on musl; that is fine, it is optional and dropped from the runtime image.
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build

# ---- runtime: production deps only, no optional deps (no global hotkey in a container) ----
FROM node:22-alpine AS runtime
RUN apk add --no-cache su-exec
ENV NODE_ENV=production \
    CONFIG_DIR=/data \
    BIND_HOST=0.0.0.0 \
    UI_PORT=8787 \
    HOTKEY_ENABLED=false
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/bridge/package.json packages/bridge/
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund \
      --workspace @offaxis/bridge --workspace @offaxis/shared \
    && npm cache clean --force
COPY --from=build /src/packages/shared/dist packages/shared/dist
COPY --from=build /src/packages/bridge/dist packages/bridge/dist
COPY --from=build /src/packages/web/dist packages/bridge/public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data
WORKDIR /app/packages/bridge
VOLUME ["/data"]
EXPOSE 8787 21412/udp 49983/udp
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
