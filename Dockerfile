FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
COPY src ./src
COPY public ./public
COPY db ./db
COPY docs ./docs

EXPOSE 8080
CMD ["node", "src/server.js"]
