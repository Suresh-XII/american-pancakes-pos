# syntax = docker/dockerfile:1

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim AS base

LABEL fly_launch_runtime="Node.js"

WORKDIR /app

ENV NODE_ENV="production"
ENV PORT=8080
ENV FLO_DEV_USER_DATA=/data

# Build stage
FROM base AS build

# Install build dependencies
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential pkg-config python3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy package manifests for root and frontend
COPY package*.json ./
COPY frontend/package*.json ./frontend/

# Install dependencies with engine-strict disabled to prevent lint-staged node version mismatch
RUN npm install --engine-strict=false --ignore-scripts
RUN cd frontend && npm install --engine-strict=false

# Copy full application code
COPY . .

# Build frontend and backend
ENV NEXT_BUILD_MODE=desktop
RUN npm run build:frontend && npm run build

# Final runtime image
FROM base

WORKDIR /app

# Ensure SQLite storage mount exists
RUN mkdir -p /data
VOLUME /data

# Copy built application and runtime dependencies
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/frontend/out ./frontend/out
COPY --from=build /app/dev-server.js ./dev-server.js
COPY --from=build /app/main ./main
COPY --from=build /app/shared ./shared
COPY --from=build /app/starter-data ./starter-data

EXPOSE 8080

# Start the headless web/Express POS server
CMD [ "node", "dev-server.js" ]
