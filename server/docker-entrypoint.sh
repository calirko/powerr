#!/bin/sh
set -e

mkdir -p "$(dirname "${DATABASE_URL#file:}")"
bunx prisma migrate deploy
exec bun run src/index.ts
