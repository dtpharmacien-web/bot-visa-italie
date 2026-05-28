FROM node:24-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./

COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY scripts/ ./scripts/

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

ENV PORT=5000
ENV NODE_ENV=production

EXPOSE 5000

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
