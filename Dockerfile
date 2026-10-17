# Node 20 (onnxruntime-node needs a newer Node than the other services' 16). Debian slim, not
# alpine: onnxruntime-node ships glibc binaries. ffmpeg comes with ffmpeg-static (no apt install).
FROM node:20-bookworm-slim

WORKDIR /usr/src

COPY package.json ./

COPY yarn.lock ./

RUN yarn install --frozen-lockfile

COPY . .

RUN yarn build

# The model is not in the image: mount it (e.g. -v /srv/models:/usr/src/models).
EXPOSE 9096

CMD ["node", "./dist/main.js"]
