# syntax = docker/dockerfile:1
FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV FLO_DEV_USER_DATA=/data
ENV FLO_ALLOW_REMOTE_SETUP=1

# Install essential native build dependencies for better-sqlite3 compilation on Linux
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential python3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy package manifests
COPY package*.json ./

# Install production dependencies and compile better-sqlite3 for Linux
RUN npm install --omit=dev --engine-strict=false --ignore-scripts && \
    npm rebuild better-sqlite3

# Ensure persistent SQLite data directory exists
RUN mkdir -p /data
VOLUME /data

# Copy pre-compiled frontend, dist, and required server assets
COPY dist ./dist
COPY frontend/out ./frontend/out
COPY dev-server.js ./dev-server.js
COPY main ./main
COPY shared ./shared
COPY starter-data ./starter-data

EXPOSE 8080

# Start headless web POS server
CMD [ "node", "dev-server.js" ]
