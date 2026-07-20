FROM oven/bun:1 AS web-build
WORKDIR /app
COPY web/package.json web/bun.lock ./web/
RUN cd web && bun install --frozen-lockfile
COPY web ./web
COPY server ./server
RUN cd web && bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile
COPY server .
COPY --from=web-build /app/server/public ./public
RUN bunx prisma generate

ENV NODE_ENV=production
ENV DATABASE_URL="file:/app/data/prod.db"

COPY server/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
