# syntax = docker/dockerfile:1

FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Crucial: set development so npm installs build tools (Tailwind, PostCSS, TypeScript)
ENV NODE_ENV=development

# Install essential OS packages for native module compilation
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential pkg-config python3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy package manifests for root and frontend
COPY package*.json ./
COPY frontend/package*.json ./frontend/

# Install root and frontend dependencies including devDependencies
RUN npm install --include=dev --engine-strict=false --ignore-scripts
RUN cd frontend && npm install --include=dev --engine-strict=false

# Copy entire application source
COPY . .

# Build Next.js frontend with Tailwind and TypeScript
ENV NEXT_BUILD_MODE=desktop
RUN cd frontend && npm run build

# Build backend TypeScript
RUN npm run build

# ── Production Runtime ───────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV FLO_DEV_USER_DATA=/data

# Ensure persistent SQLite data directory exists
RUN mkdir -p /data
VOLUME /data

# Copy built application and runtime dependencies from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend/out ./frontend/out
COPY --from=builder /app/dev-server.js ./dev-server.js
COPY --from=builder /app/main ./main
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/starter-data ./starter-data

EXPOSE 8080

# Start headless web POS server
CMD [ "node", "dev-server.js" ]
