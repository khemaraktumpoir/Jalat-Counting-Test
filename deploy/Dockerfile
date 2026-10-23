# Node 20 (onnxruntime-node needs a newer Node than the other services' 16). Debian slim, not
# alpine: onnxruntime-node ships glibc binaries. ffmpeg comes with ffmpeg-static (no apt install).
# Two stages: build with every package, run with the production ones only (smaller image, less to
# download on a small server; onnxruntime's Windows / macOS libraries are dropped). Runs as the
# non-root "node" user. The model is not in the image: mount it at /usr/src/models.

# ---- build ----
FROM node:20-bookworm-slim AS build
WORKDIR /usr/src
COPY package.json yarn.lock ./
# --ignore-scripts: no git hooks (the husky "prepare") in an image. The one install script that
# matters is ffmpeg-static's (it downloads ffmpeg), run by hand; onnxruntime-node ships its CPU
# library in the package.
RUN yarn install --frozen-lockfile --ignore-scripts \
  && node node_modules/ffmpeg-static/install.js
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN yarn build

# ---- production packages only ----
FROM node:20-bookworm-slim AS deps
WORKDIR /usr/src
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --ignore-scripts \
  && node node_modules/ffmpeg-static/install.js \
  && yarn cache clean \
  && rm -rf node_modules/onnxruntime-node/bin/napi-v3/win32 node_modules/onnxruntime-node/bin/napi-v3/darwin

# ---- run ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /usr/src
# --chown while copying (a RUN chown -R afterwards would copy every file into a second layer).
COPY --chown=node:node --from=deps /usr/src/node_modules ./node_modules
COPY --chown=node:node --from=build /usr/src/dist ./dist
COPY --chown=node:node package.json ./
# The test belt video (MODEL_PATH=demo:orange) and the default COCO labels.
COPY --chown=node:node samples ./samples
COPY --chown=node:node models/classes.json ./models/classes.json
USER node

EXPOSE 9096
# /health answers {"status":"ok",…} when the service is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9096)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "./dist/main.js"]
