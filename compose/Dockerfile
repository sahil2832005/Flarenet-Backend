# Pinned base (node:20-slim). Update digest when upgrading Node/OS: docker pull node:20-slim && docker inspect --format='{{index .RepoDigests 0}}' node:20-slim
ARG NODE_IMAGE=node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

# ── Builder: install deps + prisma generate (root — fast, no permission issues) ──
FROM ${NODE_IMAGE} AS builder

WORKDIR /usr/src/app

RUN apt-get update -y && \
    apt-get install -y openssl ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev --legacy-peer-deps --no-audit && \
    npm install prisma@5.22.0 --no-save --legacy-peer-deps --no-audit && \
    npm cache clean --force

COPY prisma ./prisma/

RUN npx prisma generate

COPY . .

# ── Runner: lean production image (one copy from builder, no per-folder COPY) ──
FROM ${NODE_IMAGE} AS runner

WORKDIR /usr/src/app

RUN apt-get update -y && \
    apt-get install -y openssl ca-certificates dumb-init && \
    groupadd -r flarenet && useradd -r -g flarenet -m -d /home/flarenet flarenet && \
    chown flarenet:flarenet /usr/src/app && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=flarenet:flarenet /usr/src/app .

USER flarenet

ENV NODE_ENV=production

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
