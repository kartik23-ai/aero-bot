FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache ffmpeg python3 ca-certificates curl yt-dlp && \
    update-ca-certificates

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY db ./db
COPY docs ./docs

EXPOSE 7860
CMD ["node", "--openssl-legacy-provider", "src/server.js"]
