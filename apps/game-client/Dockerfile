# Build context must be the repo root: docker build -f apps/game-client/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/game-client/package.json apps/game-client/package.json
COPY apps/admin-dashboard/package.json apps/admin-dashboard/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
ARG VITE_SERVER_URL=http://localhost:3000
ENV VITE_SERVER_URL=$VITE_SERVER_URL
RUN npm run build --workspace=game-client

FROM nginx:alpine AS runtime
COPY --from=build /app/apps/game-client/dist /usr/share/nginx/html
EXPOSE 80
