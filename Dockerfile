FROM node:20-slim AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/packages/adapters/dist ./packages/adapters/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/judges/dist ./packages/judges/dist
COPY --from=builder /app/packages/report/dist ./packages/report/dist
COPY --from=builder /app/packages/runner/dist ./packages/runner/dist
COPY --from=builder /app/packages/taskpacks/dist ./packages/taskpacks/dist
COPY --from=builder /app/packages/trace/dist ./packages/trace/dist
COPY --from=builder /app/apps/web-report/dist ./apps/web-report/dist
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

EXPOSE 4320
ENTRYPOINT ["node", "packages/cli/dist/index.js"]
CMD ["ui", "--host", "0.0.0.0"]
