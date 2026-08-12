# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline 2>/dev/null \
    || npm ci --prefer-offline \
    || npm ci

COPY . .
ENV DATABASE_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder"
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/scripts ./scripts
# Prisma seed (ts-node) imports ../src/common/* from prisma/*.ts; production image otherwise has no src/.
COPY --from=builder --chown=node:node /app/src/common/administraciones-selector-excluidas.ts ./src/common/administraciones-selector-excluidas.ts

# solicitudes.controller.ts writes cotización PDFs under process.cwd()/uploads —
# the directory must exist and belong to the unprivileged user.
RUN mkdir -p /app/uploads/cotizaciones && chown -R node:node /app/uploads

# Drop root: the API never needs privileged access at runtime.
USER node

EXPOSE 3001

# start-period covers `prisma migrate deploy` + the catalog seed before the
# HTTP server binds (see start:prod).
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start:prod"]
