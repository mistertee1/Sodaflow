# Isolated acceptance builder. No production credentials or app data.
FROM eclipse-temurin:21-jre-jammy AS java
FROM node:24-bookworm AS acceptance
COPY --from=java /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH=/opt/java/openjdk/bin:$PATH
ENV CI=true
ENV NODE_ENV=test
WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci
RUN npx playwright install --with-deps chromium
COPY . .
ARG RENDER_GIT_COMMIT
ENV RENDER_GIT_COMMIT=$RENDER_GIT_COMMIT
RUN node ops/render-super-admin/acceptance.mjs

# Serve only the synthetic acceptance summary. No ERP API, SDK, emulator,
# source keys, local organization file or test screenshots in the final image.
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /report
COPY --from=acceptance /work/.render-acceptance/summary.json ./summary.json
COPY ops/render-super-admin/report-server.mjs ./report-server.mjs
USER node
EXPOSE 10000
CMD ["node", "report-server.mjs"]
