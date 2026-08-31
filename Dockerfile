FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

# server's runtime dependencies, installed from server/package.json alone rather than pruned
# out of the workspace-wide install above. `npm prune --omit=dev` on the hoisted root tree still
# leaves the web workspace's own dependencies (react, react-dom, and the rest) in place, since
# those are real (non-dev) dependencies of the web workspace, just not of the server one. An
# isolated install here, outside the workspaces context, can only ever resolve what server's own
# package.json asks for.
FROM node:22-bookworm-slim AS server-deps
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=server-deps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/drizzle ./drizzle
COPY --from=build /app/server/public ./public
EXPOSE 8422
CMD ["node", "dist/index.js"]
