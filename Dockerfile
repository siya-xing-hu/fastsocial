# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/extension/package.json apps/extension/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages

RUN pnpm build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV FAST_SOCIAL_HOST=0.0.0.0
ENV FAST_SOCIAL_PORT=5127
ENV FAST_SOCIAL_DATA_DIR=/data

WORKDIR /opt/fast-social

COPY --from=builder /workspace/dist/server ./server
COPY --from=builder /workspace/dist/extension ./extension
COPY docker/entrypoint.sh /usr/local/bin/fast-social-entrypoint

RUN chmod +x /usr/local/bin/fast-social-entrypoint \
  && mkdir -p /data /output/extension

EXPOSE 5127

VOLUME ["/data", "/output"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "const port = process.env.FAST_SOCIAL_PORT || '5127'; fetch('http://127.0.0.1:' + port + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/fast-social-entrypoint"]
