# Junkyard Draft replay verifier — small public service that re-simulates replays and keeps the
# verified board. Build: docker build -t junkyard-verifier .   Run: see server/README.md
# The bundle is always built inside the image (server/dist and server/data are in .dockerignore), so host-generated
# output and its permissions never reach the container; the final file is copied world-readable for the nonroot user.
# Built outside the dev machine (no Docker there): an external review built it successfully once those two rules held.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY game/src/sim ./game/src/sim
COPY server ./server
RUN npm run verifier:build

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4400 DATA_DIR=/data RATE_LIMIT=60 CORS_ORIGIN=*
WORKDIR /app
COPY --from=build --chmod=0644 /app/server/dist/verify.mjs ./verify.mjs
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4400
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4400/health || exit 1
CMD ["node", "verify.mjs"]
