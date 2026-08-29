# One-shot migrate+seed init container (see docker-compose.yml services
# `migrate` and `seed`) — not a long-running deployable.
FROM node:20-alpine
WORKDIR /app/db
COPY db/package*.json ./
RUN npm install
COPY db/ ./
