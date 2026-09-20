ARG NODE_IMAGE
ARG BUN_IMAGE
FROM ${BUN_IMAGE} AS bun
FROM ${NODE_IMAGE} AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# Vite embeds this public URL at build time. Runtime env cannot change it.
# I01/T09 own browser identity; an origin alone never proves authenticated access.
ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=${VITE_CONVEX_URL}
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
