FROM node:22-slim AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-slim
WORKDIR /app

# Copy built output from builder
COPY --from=builder /app/packages/cli/dist ./packages/cli/dist
COPY --from=builder /app/packages/adapters/dist ./packages/adapters/dist
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/judges/dist ./packages/judges/dist
COPY --from=builder /app/packages/report/dist ./packages/report/dist
COPY --from=builder /app/packages/runner/dist ./packages/runner/dist
COPY --from=builder /app/packages/taskpacks/dist ./packages/taskpacks/dist
COPY --from=builder /app/packages/trace/dist ./packages/trace/dist
COPY --from=builder /app/apps/web-report/dist ./apps/web-report/dist

# Copy all package.json files needed for pnpm workspace resolution.
# The workspace protocol (workspace:*) requires each workspace member's
# package.json to be present for pnpm to resolve inter-package dependencies.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=builder /app/packages/cli/package.json ./packages/cli/package.json
COPY --from=builder /app/packages/adapters/package.json ./packages/adapters/package.json
COPY --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder /app/packages/judges/package.json ./packages/judges/package.json
COPY --from=builder /app/packages/report/package.json ./packages/report/package.json
COPY --from=builder /app/packages/runner/package.json ./packages/runner/package.json
COPY --from=builder /app/packages/taskpacks/package.json ./packages/taskpacks/package.json
COPY --from=builder /app/packages/trace/package.json ./packages/trace/package.json
COPY --from=builder /app/apps/web-report/package.json ./apps/web-report/package.json
RUN corepack enable && pnpm install --frozen-lockfile --prod

RUN useradd -m -s /bin/sh agentarena
USER agentarena

EXPOSE 4320
ENTRYPOINT ["node", "packages/cli/dist/index.js"]
CMD ["ui", "--host", "0.0.0.0"]
