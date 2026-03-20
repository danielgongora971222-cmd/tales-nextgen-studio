# Build fronten
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime (API)
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV SERVE_CLIENT=1

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server

EXPOSE 8080
CMD ["node", "--import", "./server/instrument.mjs", "server/server.js"]
