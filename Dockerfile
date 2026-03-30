# ── Stage 1: Build the React frontend ────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# ── Stage 2: Production server ────────────────────────────────────
FROM node:20-slim

# Install Playwright system dependencies (Chromium needs these)
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 libx11-xcb1 \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy server code + install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm install

# Install Playwright Chromium browser
RUN cd server && npx playwright install chromium

# Copy React build from Stage 1
COPY --from=builder /app/dist ./dist

# Copy server source
COPY server/ ./server/

EXPOSE 3001

ENV PORT=3001
ENV NODE_ENV=production

CMD ["node", "server/index.js"]
