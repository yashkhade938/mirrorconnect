FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY shared/package.json shared/package.json
RUN npm install

FROM deps AS build
WORKDIR /app
COPY shared shared
COPY backend backend
RUN npm run build --workspace @mirrorconnect/shared
RUN npm run build --workspace @mirrorconnect/backend

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY --from=build /app/shared shared
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/prisma backend/prisma
COPY package.json package.json
COPY backend/package.json backend/package.json
EXPOSE 4000
CMD ["sh", "-c", "npm run migrate:deploy --workspace @mirrorconnect/backend && npm run start --workspace @mirrorconnect/backend"]
