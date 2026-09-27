FROM node:22-alpine

WORKDIR /app

COPY server.js ./
COPY main.html ./public/index.html

ENV PORT=8080
ENV DATA_DIR=/data

EXPOSE 8080
VOLUME /data

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["node", "server.js"]
