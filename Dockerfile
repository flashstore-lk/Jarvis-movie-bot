
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build


FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV AUTH_DIR=/app/auth_info

COPY package*.json ./

RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

RUN mkdir -p /app/auth_info

EXPOSE 3000

CMD ["npm", "start"]
