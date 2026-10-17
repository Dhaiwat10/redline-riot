# Builds the client, then runs the game server, which also serves the built client.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @rr/client build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/apps/client/dist
EXPOSE 8080
WORKDIR /app/apps/server
CMD ["node", "--import", "tsx", "src/index.ts"]
