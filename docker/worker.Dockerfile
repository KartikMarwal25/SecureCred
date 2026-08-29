# securecred-worker — build context is the REPO ROOT (see docker-compose.yml).
# The worker imports several modules directly from apps/api/src (chain
# adapter, repositories, lifecycle service — see worker.js) rather than
# duplicating them, so BOTH apps/api and apps/worker source trees must be
# present at the same relative depth inside the image.
FROM node:20-alpine AS base
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/worker apps/worker

WORKDIR /app/apps/worker
CMD ["node", "src/worker.js"]
