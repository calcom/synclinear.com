# syntax=docker/dockerfile:1.4

####################################################################################################
## Build Packages

FROM node:18 AS builder
WORKDIR /synclinear

COPY package.json .
RUN corepack enable && corepack prepare

COPY pnpm-lock.yaml .
RUN pnpm fetch
COPY . .
RUN pnpm install --recursive --offline --frozen-lockfile

RUN pnpm run build

####################################################################################################
## Create Production Image

FROM node:18-alpine AS runtime
WORKDIR /synclinear

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /synclinear/public ./public
COPY --from=builder --chown=nextjs:nodejs /synclinear/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /synclinear/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000

CMD ["node", "server.js"]