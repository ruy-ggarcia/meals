# The Meals server image. docs/deployment.md explains how releases build it
# and how the host runs it.

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
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
# The name is the node image's own user, and it resolves inside the image. The
# rule asks for a numeric ID for hosts that must resolve the user by ID, which
# Docker Compose on the host doesn't need.
# hadolint ignore=DL3066
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=1s \
  CMD ["node", "server/healthcheck.js"]
# exec replaces the shell, so Node receives the signals. The umask keeps new
# data files writable by the docker group on the host.
CMD ["/bin/sh", "-c", "umask 0002 && exec node server/index.js"]
