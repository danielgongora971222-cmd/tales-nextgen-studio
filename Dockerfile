# Production container for Tales NextGen Studio
# - Builds the Vite frontend
# - Runs the Express API server which can also serve the built frontend (dist/)
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8788
ENV SERVE_CLIENT=1

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server

EXPOSE 8788
CMD ["node", "server/server.js"]
