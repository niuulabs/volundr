# syntax=docker/dockerfile:1.4

# ── Stage 1: build ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json ./
RUN npm ci --frozen-lockfile

# Copy source and build
COPY . .
RUN npm run build

# ── Stage 2: serve ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove default nginx site
RUN rm /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/mimir-ui.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
