# The counting service's everyday commands. `make` or `make help` lists them.
# Docker commands use the root .env (COMPOSE_FILE points at deploy/), as `docker compose` does.

.PHONY: help dev build start test lint format \
	up down restart logs ps health rebuild \
	seed model-inspect model-bench model-try frames \
	export export-photo export-embedder split train train-photo

# Use Git for Windows' bash for recipe shells (GNU Make on Windows can't run these via cmd.exe)
ifeq ($(OS),Windows_NT)
SHELL := C:/Program Files/Git/bin/bash.exe
.SHELLFLAGS := -c
endif

# Training and model export live next to this service, in Jalat-Ultralytics-Service: its own
# Makefile does the work (and writes into this service's models/); the targets below hand over to it.
TRAIN := ../Jalat-Ultralytics-Service

PORT ?= 9096
MODEL ?= models/yolo26n.onnx
VIDEO ?= test-videos/warehouse-zone-by-hand.mp4
EVERY ?= 2
MINUTES ?= 10

## help: this list
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed -e 's/^## /  make /' -e 's/: /\t/' | expand -t 26

# ---- Code ----

## dev: run the service on this PC with watch (yarn dev)
dev:
	yarn dev

## build: compile to dist/
build:
	yarn build

## start: build, then run dist/main.js
start:
	yarn start

## test: the unit tests (jest)
test:
	yarn test

## lint: eslint --fix on src/
lint:
	yarn lint

## format: prettier on the TypeScript files
format:
	npx prettier --write "src/**/*.ts" "scripts/**/*.ts"

# ---- Docker (deploy/docker-compose.yml, + .local.yml through COMPOSE_FILE in .env) ----

## up: build and start in Docker (local: + Postgres and MQTT)
up:
	docker compose up -d --build

## down: stop and remove the containers (the database volume is kept)
down:
	docker compose down

## restart: restart the service container (a new model in models/ is loaded)
restart:
	docker compose restart counting

## rebuild: rebuild the image without cache, then start
rebuild:
	docker compose build --no-cache counting && docker compose up -d

## logs: follow the service's log
logs:
	docker compose logs -f --tail 100 counting

## ps: the containers and their health
ps:
	docker compose ps

## health: GET /health on this machine
health:
	@curl -s -m 5 localhost:$(PORT)/health && echo || echo "No answer on :$(PORT)"

# ---- Data and models ----

## seed: the sample camera on the test video (yarn db:seed)
seed:
	yarn db:seed

## model-inspect: check MODEL's output (MODEL=models/yolo26n.onnx)
model-inspect:
	yarn model:inspect $(MODEL)

## model-bench: ms a frame on this CPU (MODEL=…, THREADS=1 for a 1-vCPU server)
model-bench:
	yarn model:bench $(MODEL) $(if $(THREADS),--threads $(THREADS),) --runs 50

## model-try: the whole pipeline on a video (MODEL=…, VIDEO=…)
model-try:
	yarn model:try $(MODEL) $(VIDEO)

## frames: grab frames to label (CAMERA=<id> TOKEN=<token>, or SOURCE=rtsp://…|file)
frames:
	@if [ -n "$(CAMERA)" ]; then \
		COUNTING_TOKEN="$(TOKEN)" yarn frames:grab --camera $(CAMERA) --every $(EVERY) --minutes $(MINUTES); \
	elif [ -n "$(SOURCE)" ]; then \
		yarn frames:grab "$(SOURCE)" --every $(EVERY) --minutes $(MINUTES); \
	else \
		echo "Give CAMERA=<id> TOKEN=<token>, or SOURCE=rtsp://… / a video file"; exit 1; \
	fi

# ---- Training: handed to $(TRAIN)'s Makefile (see its README); variables given here go along ----

## export: YOLO26n to ONNX, end-to-end (nms=False), into models/yolo26n.onnx
export:
	$(MAKE) -C $(TRAIN) export

## export-photo: the zero-shot parcel model (YOLO-World) into models/parcel-world-m.onnx (SIZE=m|l, or cam)
export-photo:
	$(MAKE) -C $(TRAIN) export-photo

## export-embedder: the parcel look-alike model for Count photos (CLIP) into models/parcel-embed.onnx
export-embedder:
	$(MAKE) -C $(TRAIN) export-embedder

## split: labelled frames into train / val (EXPORT=<the labelling tool's YOLO export>)
split:
	@test -n "$(EXPORT)" || (echo "Give EXPORT=<folder of the YOLO export>"; exit 1)
	$(MAKE) -C $(TRAIN) split EXPORT="$(abspath $(EXPORT))"

## train-photo: YOLO-World fine-tuned on labelled photos → models/parcel-photo.onnx + parcel-cam.onnx (PHOTO_MODEL=l|m)
train-photo:
	$(MAKE) -C $(TRAIN) train-photo

## train: the YOLO26n belt model → models/parcel.onnx (EPOCHS=100, DEVICE=cpu|0)
train:
	$(MAKE) -C $(TRAIN) train
