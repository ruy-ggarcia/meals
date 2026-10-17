# The Meals server image. docs/deployment.md explains how releases build it
# and how the host runs it.

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
ARG REVISION=unknown
ARG VERSION=unknown
LABEL org.opencontainers.image.revision=$REVISION \
      org.opencontainers.image.source=https://github.com/ruy-ggarcia/meals \
      org.opencontainers.image.version=$VERSION
ENV DATA_DIR=/data NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY public ./public
COPY server ./server
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=1s \
  CMD ["node", "server/healthcheck.js"]
# exec replaces the shell, so Node receives the signals. The umask keeps new
# data files writable by the docker group on the host.
CMD ["/bin/sh", "-c", "umask 0002 && exec node server/index.js"]
