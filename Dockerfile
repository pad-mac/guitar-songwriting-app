FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && rm -rf /root/.npm

COPY server ./server
COPY web ./web

USER node
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
