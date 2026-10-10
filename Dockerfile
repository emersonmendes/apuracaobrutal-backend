# Imagem de produção do backend (spec: dev-environment FR-01, R-5, R-8).
# A stack de desenvolvimento (docker-compose.yml na raiz) sobrescreve NODE_ENV=development.

FROM node:24-alpine AS base
# O Prisma exige openssl em runtime e na geração do client.
RUN apk add --no-cache openssl
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
# O `postinstall` roda `prisma generate`, que precisa do schema.
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3433
CMD ["node", "dist/main"]
