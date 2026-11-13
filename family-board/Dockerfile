# Build: install, test, and bundle the web app and server.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test && npm run build

# Run: the bundled server needs only Node and the dist folder.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8710 \
    DATA_DIR=/data \
    BACKUP_DIR=/backups \
    WEB_DIR=/app/dist/web \
    TZ=America/New_York
COPY --from=build /app/dist ./dist
VOLUME ["/data", "/backups"]
EXPOSE 8710
HEALTHCHECK --interval=1m --timeout=5s CMD wget -qO- http://localhost:8710/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/index.js"]
