FROM node:24.15.0-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY package.json package-lock.json ./
COPY relay/package.json relay/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev --workspace=@bambicam/relay --ignore-scripts && npm cache clean --force
COPY --chown=node:node relay/server.mjs relay/server.mjs
USER node
EXPOSE 8787
CMD ["node", "relay/server.mjs"]
