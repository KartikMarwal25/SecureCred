# securecred-api — build context is the REPO ROOT (see docker-compose.yml),
# because this is an npm-workspaces monorepo: @securecred/api depends on
# @securecred/shared via a workspace symlink that only resolves correctly
# when `npm install` runs from the root with every workspace's package.json
# present.
#
# apps/worker's SOURCE (not just its package.json) is also copied in: when
# RUN_WORKER_INLINE=true (a single-host deployment with no separate worker
# process — see server.js), this same process imports apps/worker/src's
# eventListener/reconciler/batchReconciler directly, reusing them rather
# than duplicating that logic. Unused (and does nothing extra) when
# RUN_WORKER_INLINE is left off, as it is for docker-compose's own stack,
# which still runs the real, separate `worker` service.
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

# chain.adapter.js reads contracts/deployments/<network>.json for the
# contract address/ABI. docker-compose's own api service instead bind-mounts
# this directory from the host at runtime (see docker-compose.yml) — that
# only works for docker-compose itself; a standalone image (e.g. deployed on
# Render, with no host volume to mount) needs the file baked in directly, or
# every chain call fails with "Contract not deployed for network ...".
COPY contracts/deployments contracts/deployments

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "src/server.js"]
