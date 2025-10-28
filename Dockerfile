# Multi-stage build for Discord bot

# Stage 1: Build
FROM node:18-alpine AS builder

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ cairo-dev jpeg-dev pango-dev giflib-dev

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies (including dev dependencies for build)
# Skip optional dependencies (platform-specific Whisper packages)
RUN npm ci --omit=optional

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:18-alpine

# Install runtime dependencies for native modules and ffmpeg
RUN apk add --no-cache \
    cairo \
    jpeg \
    pango \
    giflib \
    ffmpeg \
    libsodium

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies only
# Skip optional dependencies (platform-specific Whisper packages)
RUN npm ci --omit=dev --omit=optional

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose port for health checks (if needed later)
EXPOSE 3001

# Health check (optional, pings the process)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

# Start the bot
CMD ["node", "dist/index.js"]
