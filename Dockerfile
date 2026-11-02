# Tests first: if they fail, the build stops and the running version stays up.
FROM node:22-bookworm-slim AS test
WORKDIR /app
COPY package.json ./
COPY web ./web
COPY test ./test
RUN node --test test/*.test.mjs && touch /tested

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && rm -rf /root/.npm
COPY --from=test /tested /tested
COPY server ./server
COPY web ./web

# the deployed commit, shown by /healthz (last, so it doesn't spoil the layer cache)
ARG COMMIT=""
ENV COMMIT=$COMMIT

USER node
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
