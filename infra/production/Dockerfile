ARG NODE_IMAGE
ARG BUN_IMAGE
FROM ${BUN_IMAGE} AS bun
FROM ${NODE_IMAGE} AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# Private preparation artifact only: website owner must supply its reviewed public
# Convex origin at build time if retaining reactive browser access (issue #26).
# The reserved placeholder cannot expose the private backend; do not activate it.
ENV VITE_CONVEX_URL=https://convex.invalid
RUN bun run build && bun build src/server/config.ts --target=node --format=esm --outfile=production-config.mjs

FROM ${NODE_IMAGE} AS runtime
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.source="https://github.com/freebatteryfactory/think-wide-hackathon"
LABEL org.opencontainers.image.revision=${SOURCE_COMMIT}
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /build/.output ./.output
COPY --from=build --chown=node:node /build/production-config.mjs ./production-config.mjs
COPY --chown=node:node infra/production/entrypoint.mjs ./entrypoint.mjs
USER node
EXPOSE 3000
CMD ["node", "entrypoint.mjs"]
