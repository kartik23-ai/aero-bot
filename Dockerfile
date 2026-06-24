FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Install media download and processing dependencies + SSL certs
RUN apk add --no-cache ffmpeg python3 ca-certificates curl && \
    update-ca-certificates && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY db ./db
COPY docs ./docs

EXPOSE 7860
CMD ["node", "src/server.js"]
