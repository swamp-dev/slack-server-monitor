# Slack Server Monitor Dockerfile
#
# Build: docker build -t slack-monitor .
# Run: docker run -d --env-file .env -v /var/run/docker.sock:/var/run/docker.sock:ro slack-monitor

FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Install Docker CLI for container management commands (uses mounted docker.sock)
# Install procps for system monitoring commands (ps, free, uptime)
# Install curl for Docker health check (hits /health endpoint)
RUN apk add --no-cache docker-cli procps curl

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Note: appuser needs to be in docker group to access docker.sock
# This is handled at runtime via volume mount permissions

USER appuser

# Health check - verifies Socket Mode WebSocket is connected via /health endpoint.
# Requires WEB_ENABLED=true (default in production).
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -sf http://localhost:${WEB_PORT:-8085}/health || exit 1

CMD ["node", "dist/app.js"]
