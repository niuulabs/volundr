# Stage 1: Build the Volundr web UI
FROM node:24-alpine@sha256:7fddd9ddeae8196abf4a3ef2de34e11f7b1a722119f91f28ddf1e99dcafdf114 AS build

WORKDIR /app

# Copy package files for dependency caching
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY web/ .
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:1.29-alpine@sha256:f46cb72c7df02710e693e863a983ac42f6a9579058a59a35f1ae36c9958e4ce0

LABEL org.opencontainers.image.title="volundr-web"
LABEL org.opencontainers.image.description="Volundr Web — AI-native development platform UI"
LABEL org.opencontainers.image.vendor="Niuu Labs"
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/niuulabs/volundr"

# Create non-root user
RUN addgroup -g 1001 -S volundr && \
    adduser -u 1001 -S volundr -G volundr && \
    chown -R volundr:volundr /var/cache/nginx /var/log/nginx /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown volundr:volundr /var/run/nginx.pid

# Copy nginx config
COPY containers/volundr-web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built app
COPY --from=build /app/dist /usr/share/nginx/html

# Health check endpoint
RUN echo "OK" > /usr/share/nginx/html/health

USER 1001

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
