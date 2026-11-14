FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install root dependencies
COPY package*.json ./
RUN npm install

# Install frontend dependencies
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install

# Copy application source
COPY . .

# Build frontend and backend
ENV NEXT_BUILD_MODE=desktop
RUN npm run build:frontend && npm run build

# Production runtime
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV FLO_DEV_USER_DATA=/data

RUN mkdir -p /data

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend/out ./frontend/out
COPY --from=builder /app/dev-server.js ./dev-server.js
COPY --from=builder /app/main ./main
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/starter-data ./starter-data

EXPOSE 3001

CMD ["node", "dev-server.js"]
