FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV UDHAAR_DATA_FILE=/data/ledger.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY public ./public
RUN useradd --create-home --shell /usr/sbin/nologin udhaar \
    && mkdir -p /data \
    && chown -R udhaar:udhaar /data /app
USER udhaar
EXPOSE 3000
CMD ["node", "dist/server.js"]
