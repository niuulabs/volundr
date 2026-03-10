# Stage 1: Build the Volundr web UI
FROM node:22-alpine AS build

WORKDIR /app

# Copy package files for dependency caching
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY web/ .
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:1.27-alpine

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
