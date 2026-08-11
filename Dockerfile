# One image, two entry points: the operator and the confidential-compute enclave.
# Which one runs is decided by DORR_ROLE at boot, so both Heroku apps deploy the
# same digest and there is exactly one build to reason about.
FROM oven/bun:1.3-alpine

WORKDIR /app

# Manifests first so a source-only change reuses the dependency layer.
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/engine/package.json ./packages/engine/package.json
COPY services/operator/package.json ./services/operator/package.json
COPY tools/package.json ./tools/package.json

RUN bun install --frozen-lockfile || bun install

COPY packages ./packages
COPY services ./services

# Heroku's filesystem is ephemeral and it injects $PORT; both are handled in
# src/env.ts and src/state.ts. DORR_STATE_PATH can point at a mounted volume
# where one exists.
ENV NODE_ENV=production
ENV DORR_ROLE=operator

CMD ["sh", "-c", "if [ \"$DORR_ROLE\" = \"enclave\" ]; then exec bun run services/operator/src/enclave/server.ts; else exec bun run services/operator/src/index.ts; fi"]
