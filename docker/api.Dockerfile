# securecred-api — build context is the REPO ROOT (see docker-compose.yml),
# because this is an npm-workspaces monorepo: @securecred/api depends on
# @securecred/shared via a workspace symlink that only resolves correctly
# when `npm install` runs from the root with every workspace's package.json
# present.
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

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "src/server.js"]
