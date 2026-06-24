FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Install media download and processing dependencies + SSL certs
RUN apk add --no-cache ffmpeg python3 yt-dlp ca-certificates && update-ca-certificates

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY db ./db
COPY docs ./docs

EXPOSE 7860
CMD ["node", "src/server.js"]
