# Build once, natively on the build machine. The output is plain JavaScript with no
# native modules, so the same dist works on amd64 and arm64. Tests run in CI before
# the image is built.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

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
