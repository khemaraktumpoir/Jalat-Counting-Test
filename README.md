# Jalat Counting Service

Counts parcels (or any object the model knows) that cross a **line** or enter an **area** on a
camera over a conveyor, in real time. The same job as Ultralytics' `ObjectCounter` ("How to Perform
Real-Time Object Counting with Ultralytics YOLO26": packages on a conveyor belt), built as a Jalat
service: no Python at runtime, several cameras, live counts for the apps, history.

- **NestJS** like the other Jalat services (GraphQL at `/v1`, TypeORM, the same JWT + Redis
  session check, MQTT), **no Python at runtime**.
- **YOLO26** exported once to **ONNX**, run with `onnxruntime-node`; frames read by **ffmpeg**
  (bundled with `ffmpeg-static`).
- One **worker thread per camera** (`src/graphql/counting/camera.worker.ts`), so inference never
  blocks the API.
- The warehouse app (`app.client/warehouse`, the **Count** tab) is the dashboard.

## Current project status

As of 3 Nov 2026 (the full list, with what blocks each task, is in the [to-do](TODO.md)):

- **Built and on `master`:** live camera counting (line or area, IN / OUT, per class), cameras for
  one or more warehouses with working hours, photo counts with duplicate detection and records,
  a shared pool of model workers, a fair photo queue. Tested end to end on the test videos.
- **Not deployed yet:** the production workflow stops at the Docker build because the repository
  has no GitHub Actions secrets; the database also needs the new columns and table first (no
  `DB_SYNC` in production).
- **Models:** the cameras use `parcel-cam.onnx`, YOLO-World medium fine-tuned on 31 labelled
  pickup photos (8 of 8 validation photos counted exactly); photos use the zero-shot
  `parcel-world-m.onnx`. A fast YOLO26n **belt** model still needs frames from a real belt.
- **First real cameras:** the CAB17 recorder's 8 channels are added (off), but the recorder
  refuses connections from here, so there is no real belt footage yet.

See also the [training guide](../Jalat-Ultralytics-Service/README.md) and the
[rollout plan](docs/rollout-plan.md).

```
ffmpeg (rgb24 frames at the camera's fps, scaled to width × height)
  → letterbox 640×640 → YOLO26 ONNX [1, 300, 6] → IoU tracker → line / area counter
  → counts: MQTT /topic/counting/<cameraId>/count (live) + CountingSnapshots (deltas every minute)
```

## Features

| | Ultralytics `ObjectCounter` (the video) | This service |
|---|---|---|
| Region | line (2 points) or polygon (3+), IN / OUT by point order | ✅ line or area, drawn in the app with an IN arrow |
| Detection | any YOLO model, `conf`, `classes` | ✅ YOLO26 ONNX (NMS-free), confidence and classes per camera |
| Tracking | `tracktrack` (default), `bytetrack`, `botsort`, `ocsort`, `deepocsort`, `fasttrack` | ✅ IoU tracker (one, see Counting rules) |
| Counts | IN / OUT | ✅ IN / OUT, and per class |
| Picture | boxes, labels, region, totals (`show_in`, `show_out`, `line_width`) | ✅ live view (MJPEG) with region, IN arrow and boxes |
| Sources | video file, camera | ✅ RTSP camera, phone with an IP-camera app, **this phone's camera** (the app sends frames), video file |
| Output | annotated video file (`cv2.VideoWriter`) | ❌ no recording; ➕ counts saved, hourly / daily history |
| Run | `yolo solutions count …`, one process | ➕ many cameras (a worker thread each), start / stop / reset, live counts on MQTT, Jalat sign-in and roles |

### Camera sources

| Source | `sourceUrl` | |
|---|---|---|
| Network camera | `rtsp://user:pass@192.168.1.20:554/stream1` | read by ffmpeg |
| Phone + IP-camera app | `http://<phone ip>:8080/video` (IP Webcam), `:4747/video` (DroidCam) | same Wi-Fi as the service |
| This phone (warehouse app) | `phone:` | the app's "Use this phone's camera" page sends JPEGs to `POST …/frames`; no frame for 10 s → "Waiting for the phone" |
| Test video | `test-videos/warehouse-zone-by-hand.mp4` | a path on the service (its folder in Docker) |
| Through the relay | `rtsp://go2rtc:8554/cam1_sub` | go2rtc (`COMPOSE_PROFILES=relay`, `deploy/go2rtc.yaml`): cameras the service should not reach directly, cloud-only ones (Tapo cloud, XMeye DVRs…) |
| This PC's webcam | `rtsp://go2rtc:8554/cam2_sub` | `yarn pc-camera` serves the webcam to the local relay (Windows), on only while a camera watches it; the camera "PC webcam" in `cameras.json` |

**Try it with this PC's webcam** (no IP camera needed; local Docker with the relay running):

1. `yarn pc-camera --list`: the webcams and the sizes they film at.
2. `yarn pc-camera --background` once (or `yarn pc-camera` in a window left open): it waits, and the relay asks it for the first webcam (640×360 at 10 fps) only while a camera on cam2 runs, so the webcam is on only then. `--status` says whether it is on, `--stop` stops it.
3. `DB_HOST=localhost DB_PORT=5433 DB_USERNAME=jalat DB_PASSWORD=jalat yarn db:seed` once: adds "PC webcam" (TEST WH 66) with a line down the middle.
4. In the warehouse app: Count → PC webcam → Start. Move a parcel across the line: IN one way, OUT the other.

The service's model runs on every frame: with `parcel-world-cam.onnx` a laptop's CPU is busy
(~860 %); set the camera's detector to `demo:orange` to try the app with an orange object instead.

### The site camera list (`test-videos/cameras.json`)

Every camera a site counts with, in one file `yarn db:seed` adds to the app: the warehouses' network
cameras, and the test videos (which the app's add-camera form also offers as ready-made cameras).
Each entry is one camera; its name is its key (seeding again changes nothing but its address and
detector).

```jsonc
{
  "name": "Zone A – floor",
  "warehouse": "TEST WH 66",                               // for people reading the file
  "warehouseId": "6a465e96-6ecb-b088-7f03-2830bc50ee80",   // the mobile warehouse's user id
  "camera": {                                              // a network camera…
    "brand": "hikvision",                                  // hikvision, dahua, ezviz, tapo, reolink, uniview, go2rtc
    "host": "192.168.1.64",                                // its fixed IP on the warehouse network
    "channel": 1,                                          // its number on a recorder (NVR); 1 alone
    "stream": "sub",                                       // the small stream: enough to count
    "password": "${CAM_ZONE_A_PASSWORD}"                   // from .env, never written here
  },
  // …or a test video: "sourceUrl": "test-videos/x.mp4" (+ "model", "region", "expected")
  "fps": 10, "confThreshold": 0.4, "width": 640, "height": 360,
  "region": { "type": "POLYGON", "points": [...] },        // optional: else draw it in the app
  "enabled": false                                         // optional: start it from the app
}
```

Adding a site's camera:

1. Mount and set up the camera (fixed IP, RTSP on, small stream H.264 ~640×360 at 10 fps).
2. Add its entry to `cameras.json` and its password to `.env` (`CAM_ZONE_A_PASSWORD=…`; one variable
   per camera). A camera whose password is not set is skipped, with a message.
3. `yarn db:seed` (Docker database: `DB_HOST=localhost DB_PORT=5433 DB_SCHEMA=jalat_counting
   DB_USERNAME=jalat DB_PASSWORD=jalat yarn db:seed`).
4. In the warehouse app (signed in as that warehouse): Count → the camera → check the picture, draw
   its line or area, Start.

The address is built as the app's form builds it (`src/lib/inference/camera-url.ts`, in step with
`app.client/warehouse/src/utils/cameraBrands.ts`). A new IP or password: change the entry or `.env`,
seed again, restart the camera.

## Folders

| | |
|---|---|
| `src/api/` | REST: snapshot, live view, phone frames, health, `/` |
| `src/graphql/counting/` | cameras, regions, history (GraphQL); `camera-manager` + one `camera.worker` thread per camera |
| `src/graphql/auth`, `user` | the Jalat sign-in (JWT + Redis session) and the user model (as the User Service) |
| `src/lib/counting/` | the counting core, no Nest: preprocess, detectors (ONNX, colour, Ultralytics API), tracker, line / area counters, drawing |
| `src/lib/inference/` | ffmpeg frames (camera, file, phone), onnxruntime model loading |
| `src/lib/{config,typeorm,ioredis,jwt,mqtt}` | the service's plumbing, as in the other Jalat services |
| `src/common/`, `entities/`, `repositories/` | shared helpers, the tables, their queries |
| `scripts/` | `db:seed`, `model:inspect`, `model:bench`, `model:try`, `frames:grab` |
| `models/` | camera baseline `yolo26n.onnx`, optional trained belt model `parcel.onnx`, and photo-count models (not committed) |
| `test-videos/` | `warehouse-zone-by-hand.mp4`, the sample: a worker carries 9 parcels by hand into a taped zone (IN 9), and the other test videos (`*-counted.mp4`: the same, counted) |
| `../Jalat-Ultralytics-Service/` | making a parcel model (next to this service, not in it): `ultralytics/` (repo + Python env), `weights/`, datasets, runs and the scripts — see its `README.md` |
| `docs/` | `rollout-plan.md`: pilot → data → model → scans → all sites |
| `.env.example` | every setting (yarn dev and docker compose); copy to `.env` |
| `deploy/` | everything Docker: `Dockerfile` (+ `Dockerfile.dockerignore`), `docker-compose.yml` (service + optional Caddy / Cloudflare Tunnel / Redis tunnel), `docker-compose.local.yml` (local Postgres and MQTT); `README.md` (servers: steps, sizes, daily commands), `setup-server.sh` |
| `.github/workflows/`, `.husky/` | CI/CD to the servers and the commit checks, as in the Location Service |

## Run it locally

`make help` lists the everyday commands (`make up`, `make logs`, `make test`, `make model-try`,
`make frames`, `make train` …); from the `jalat-apps` folder, `make counting` starts it in Docker.

```bash
cp .env.example .env          # set JWT_SECRET; DB_SYNC=true creates the tables
docker compose up -d --build  # Postgres :5433, MQTT :1884 (websockets :9002) and the service :9096
                              # (COMPOSE_FILE in .env: deploy/docker-compose.yml + .local.yml); sessions
                              # from this machine's Redis :6379 (the User Service's)
yarn install
yarn start                    # build + node dist/main.js   (or: yarn dev, with watch)
curl localhost:9096/health
```

Without a model the service still runs: cameras stream (snapshot, live view, region editor) and say
`Not counting: Model not found …`. To try everything without a model, set
`MODEL_PATH=demo:orange` — orange boxes are found by colour (`ColorDetector`) — and use the sample:

```bash
yarn db:seed                  # the cameras of test-videos/cameras.json: "Sample zone" and the other test
                              # videos (each with its area and demo:orange), and the network cameras
```

## Model

YOLO26 is exported to ONNX once (the only Python step). **`nms=False` is required**: it exports
YOLO26's end-to-end head, `[1, 300, 6]`; without it Ultralytics exports the raw `[1, 84, 8400]`
output, which needs NMS and which this service cannot read.

`../Jalat-Ultralytics-Service/ultralytics` (next to this service) is the Ultralytics repo (its own
git, AGPL-3.0; not part of this service, not in the Docker image) with a ready Python 3.13
environment, `.venv313` (PyTorch CPU, torchvision, Ultralytics installed from the repo).
`../Jalat-Ultralytics-Service/weights/` keeps the starting weights (`yolo26n.pt`) and `yolo11n.onnx`
as a speed baseline. Export the camera baseline with `make export`, or by hand:

```bash
cd ../Jalat-Ultralytics-Service/ultralytics
.venv313/Scripts/python -c "from ultralytics import YOLO; YOLO('../weights/yolo26n.pt').export(format='onnx', imgsz=640, nms=False)"
#   → ../Jalat-Ultralytics-Service/weights/yolo26n.onnx: copy it to models/
```

A belt-specific parcel model can be trained and exported in one step after preparing a labelled
dataset: `../Jalat-Ultralytics-Service/README.md` (`train_parcels.py`). It writes
`models/parcel.onnx` and `models/parcel.classes.json`; these are not currently present in this
workspace.

Without Python, with Docker (the official CPU image; the file lands in `models/`):

```bash
docker run --rm -v "$PWD/models:/out" -w /out ultralytics/ultralytics:latest-cpu \
  yolo export model=yolo26n.pt format=onnx imgsz=640 nms=False
```

`models/` holds only what the service runs (not committed): set `MODEL_PATH=models/yolo26n.onnx`
and check it:

```bash
yarn model:inspect models/yolo26n.onnx
# expects an NMS-free output [1, 300, 6] = x1, y1, x2, y2, score, class
yarn model:bench models/yolo26n.onnx ../Jalat-Ultralytics-Service/weights/yolo11n.onnx --runs 100
# ms per frame on this CPU (mean / p50 / p95, fps), and how much faster the first one is
yarn model:try models/yolo26n.onnx test-videos/warehouse-zone-by-hand.mp4
# the whole pipeline on a video: what it detects, what it counts, ms a frame
```

### Which model: YOLO26 vs YOLO11 on CPU

Ultralytics' numbers (COCO, 640 px; CPU = ONNX Runtime, GPU = T4 TensorRT 10):

| Model | mAP 50-95 | CPU ONNX ms | T4 ms | Params M |
|---|---|---|---|---|
| YOLO11n | 39.5 | 56.1 | 1.5 | 2.6 |
| **YOLO26n** | **40.9** | **38.9** | 1.7 | 2.4 |
| YOLO11s | 47.0 | 90.0 | 2.5 | 9.4 |
| YOLO26s | 48.6 | 87.2 | 2.5 | 9.5 |
| YOLO11m | 51.5 | 183.2 | 4.7 | 20.1 |
| YOLO26m | 53.1 | 220.0 | 4.7 | 20.4 |

- The "~43% faster" (Ultralytics' "YOLO26 vs YOLO11 ONNX Inference Test") is the **nano model on
  CPU**: 56.1 → 38.9 ms is 44% more frames a second (31% less time a frame). The small model is about
  the same; m / l / x are **slower** on CPU than YOLO11, though more accurate. On a GPU they are equal.
- Why: YOLO26 has no NMS step (the boxes come out final, `[1, 300, 6]`) and no DFL head, so the
  graph is simpler; on a small model on a CPU that is a large part of the time. This service reads
  that output directly (`src/lib/counting/detector.ts`) — YOLO11's raw `[1, 84, 8400]` is not supported.
- **Use YOLO26n** (YOLO26s if it misses parcels); parcels on a belt are large, clear objects.
  Measure on the server's own CPU with `yarn model:bench` and compare with the cameras' fps.
- **Measured here** (a 12-thread Windows PC, onnxruntime-node 1.18, `yarn model:bench`, 100 runs,
  two runs): YOLO26n end-to-end **71 ms (14 fps)**, YOLO11n **81–84 ms (12 fps) before its NMS** —
  14–18 % faster, more with NMS counted. The whole pipeline (`yarn model:try`) was 6 fps on a busy
  machine. Not the 43 % of the headline, but faster, and the output needs no post-processing.
- The pretrained `yolo26n` knows the 80 COCO objects (suitcase, handbag…), **not cardboard parcels**.
  For real counts, fine-tune YOLO26n on frames from the belts (a few hundred labelled images to
  start), export `best.pt` the same way and set `models/classes.json` to `["parcel"]`.

`models/classes.json` maps class index → label: the 80 COCO labels for `yolo26n`; replace it with
your own labels for a custom parcel model (`["parcel"]`). `MODEL_PROVIDER=cuda` needs the CUDA build
of onnxruntime-node.

### `MODEL_PATH` values

| `MODEL_PATH` | Detector | |
|---|---|---|
| `models/yolo26n.onnx` (or `models/parcel.onnx`) | `Detector` (onnxruntime, this server's CPU) | the normal way |
| `demo:orange` | `ColorDetector` | the sample video only: orange boxes by colour, no model |
| `ultralytics:<url>` + `ULTRALYTICS_API_KEY` | `UltralyticsApiDetector` | the model on Ultralytics Platform: one JPEG a frame over HTTPS |

`ultralytics:` takes a **dedicated endpoint** (`https://….run.app/predict`: no rate limit, paid by
active time) or the shared one (`https://platform.ultralytics.com/api/models/<owner>/<project>/<model>/predict`:
20 requests a minute — tests only, far below a camera's fps). Every frame crosses the internet
(≈100–300 ms, ≈2.5 Mbit/s a camera at 5 fps) and counting stops when it is down; on 429 the camera
waits the `Retry-After` time. Prefer a local model; use this for a site whose server is too weak.

> **Licence:** Ultralytics YOLO is AGPL-3.0. Check AGPL vs an Enterprise licence before a commercial release.

## API

GraphQL (`/v1`), roles `ADMIN`, `OPERATION`, `MOBILE_WAREHOUSE` (a warehouse sees only its own cameras):

| Query / mutation | |
|---|---|
| `countingCameras`, `countingCamera(id)` | cameras with `region` and `runtime` (status, fps, error, in / out since reset) |
| `countingHistory(cameraId, from, to, bucket: HOUR \| DAY)` | counts per hour / day (Phnom Penh); the current hour includes unsaved counts |
| `countingClasses`, `countingModel` | the model's labels; whether it is loaded |
| `createCountingCamera`, `updateCountingCamera`, `deleteCountingCamera` | |
| `startCountingCamera`, `stopCountingCamera`, `resetCountingCamera` | reset saves the counts, then counts from 0 |
| `saveCountingRegion(cameraId, type: LINE \| POLYGON, points)` | LINE: 2 points; POLYGON: 3+; inside width × height |
| `addManualCount(input: { cameraId, code?, delta })` | a manual counter (`sourceUrl: "manual:"`, no camera): a scanned QR code counts once since the last reset (`duplicate` otherwise), no code = a tap; `delta: -1` takes one back; saved as `scanned` / `tapped` in the history |
| `countingManualScans(cameraId, limit)` | a manual counter's latest QR codes since its reset |
| `countingOverview(from, to, bucket)` | every visible source counted in a time range (e.g. today), and per hour or day: cameras vs counting by scanning (includes running cameras' unsaved counts) |
| `countingPhotoFolder(path, conf, classes, limit)` | counts the objects in every photo of a folder on the service (inside `PHOTO_ROOTS`, default `photos,test-videos`), with the cameras' model: per photo and in total, by label |
| `countingPhotoBatches(from, to)` | batches of counted photos (photos, parcels, copies), newest first |
| `countingPhotoRecords(batchId, copiesOnly, from, to, limit)` | one batch's photos in the order picked, or the copies, each with the photo it repeats |
| `countingPhotoRoots` | the folders `countingPhotoFolder` may read |
| `countingPhotoModel` | what counts photos: `parcels` (the parcel model, default when `models/parcel-world-m.onnx` is there: every parcel, bag or box counts once) or `cameras` (the cameras' model, by label), and its default confidence |
| `POST /api/v1/counting/photos?name=&conf=&classes=` | REST: one uploaded photo (body `image/jpeg`): its count, by label, and the boxes (fractions of the photo); the warehouse app sends a batch one photo at a time |

REST (token as `Authorization: Bearer …` or `?access_token=`, for `<img>`):

- `GET /api/v1/counting/cameras/:id/snapshot` — one JPEG (the running camera's last frame, or one grabbed)
- `GET /api/v1/counting/cameras/:id/stream` — MJPEG live view with the region, the IN arrow and the boxes
- `POST /api/v1/counting/cameras/:id/frames` — a phone camera (`phone:`): one JPEG (`Content-Type:
  image/jpeg`, up to 3 MB, any size: scaled to the camera's); 409 when the camera is off
- `GET /health` — database, model, MQTT, enabled cameras

MQTT (retained, published only when the value changes):

- `/topic/counting/<cameraId>/count` — `{ cameraId, in, out, byClass: { label: { in, out } }, at }`
- `/topic/counting/<cameraId>/status` — `{ cameraId, status, fps, error, at }`

## Counting rules

- **Line** a→b: a track counts once when its center crosses the line; **IN** = towards the left of
  a→b (the green arrow in the editor), OUT the other way. A center that stops exactly on the line
  counts when it leaves it on the other side; touching the line and going back counts nothing.
- **Area**: outside → inside is IN, inside → outside is OUT, each at most once per track; a track
  first seen inside is not counted.
- **Tracker**: greedy IoU matching per class (`iouThreshold` 0.3), a track survives 10 missed frames.
- **Storage**: counts are saved as deltas every minute (when something was counted), on stop and on
  reset, so a restart never doubles them and a crash loses at most a minute; "since reset" = saved since `countsResetAt` + what the running worker counted.

## Tests

```bash
yarn test     # the core: preprocessing, parsing, tracker, line and area counters, pipeline,
              # and the sample video end to end (7 parcels by hand, ± 1); also the camera manager,
              # model pool, photo queue, rules and repository (151 tests, 3 Nov 2026)
```

## Deploy

**`deploy/README.md`** has the steps, server sizes and daily commands. In short: `deploy/Dockerfile`
(Node 20, two stages, ≈ 720 MB, non-root, health check; ffmpeg from ffmpeg-static); mount the model
at `/usr/src/models`; point `MQTT_*` at the apps' broker, `REDIS_*` at the User Service's Redis
(sessions) and `JWT_SECRET` at its secret.

- **A cloud server or a PC next to the cameras:** the same `deploy/docker-compose.yml` with optional parts
  (`COMPOSE_PROFILES`): `https` (Caddy, a free certificate for your domain), `cloudflare` (Cloudflare
  Tunnel), `redis-tunnel` (Redis over SSH). `deploy/setup-server.sh` prepares a fresh server
  (Docker, swap, firewall). On a small server set `MODEL_THREADS` (cores ÷ cameras) and
  `COUNTING_MEM_LIMIT`.
- **The servers, as the other Jalat services:** `.github/workflows` — a push to `development`,
  `uat` or `master` builds the image, pushes it to Huawei SWR, reads the settings from Huawei CSMS
  (`scripts/fetch_csms_secrets.js`) and updates the Docker Swarm service over SSH.

| Workflow | Branch | GitHub secrets / vars |
|---|---|---|
| `development.yml` | `development` | as the Location Service's (`IMAGE_NAME`, `REGISTRY`, `REGION`, `SWR_ORG_NAME`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `KMS_*`, `HUAWEI_PRIVATE_KEY`, `USERNAME`, `HOSTNAME`, `SWR_LOGIN_KEY`, `DOCKER_SERVICE_NAME`, `DOCKER_NETWORK_NAME`; var `SERVICE_REPLICA`) — with this service's own image, service name and CSMS secret |
| `uat.yml` | `uat` | the same names with `UAT_` in front (var `UAT_SERVICE_REPLICA`) |
| `production.yml` | `master` | the same names with `PROD_` in front (var `PROD_SERVICE_REPLICA`) |

The CSMS secret holds the service's settings (`.env` names) plus `PORT_COUNTING` (the published
port, e.g. 9096) and `MODELS_DIR` (the server folder with the model, e.g. `/srv/counting/models`,
mounted read-only at `/usr/src/models`). Keep **one replica** per set of cameras: each replica runs
every enabled camera.

**Commits:** `.husky` runs `lint-staged` (eslint + prettier on the staged files) before a commit and
commitlint (`.commitlintrc.json`, Angular: `feat(counting): …`) on the message, as the Location
Service is set up to; `yarn install` turns the hooks on.

## Not done yet

The [to-do](TODO.md) is the checklist. In short:

- **Deploy:** GitHub Actions secrets, the CSMS secret, the database columns, the models on the server.
- **A real belt:** a reachable pilot camera, then frames, labels and a YOLO26n belt model with its
  `yarn model:bench` numbers on the pilot machine.
- **Scaling** steps 1, 5 and 7 (thread settings, `sharp`, a load test).
- **Later:** an annotated video per camera, tracker choices (ByteTrack / BoT-SORT), several regions
  per camera, CSV export.

## Scaling: many cameras and users

Now: one worker thread per camera (ffmpeg, letterbox, tracking, counting) and the model in a shared
model worker (step 4, done 29 Oct 2026); photo counts in a worker thread of their own (step 3, done
29 Oct 2026), one at a time. Measured on a dev PC (28 Oct 2026): one camera on `parcel-world-cam.onnx`
≈ 1,370 % CPU, on `demo:orange` ≈ 140 %.

| Step | What | Gain |
|---|---|---|
| 1 | Settings: `MODEL_THREADS` = CPU cores ÷ (`MODEL_WORKERS` + 1 for photos); cameras on their small stream at 5–10 fps | cameras stop fighting over cores |
| 2 | A YOLO26n parcel model trained on the site's footage (`../Jalat-Ultralytics-Service`) | ~10× faster than YOLO-World M |
| 3 | ✅ Photo counts in a worker of their own, a bounded queue ("busy, try again"), each user in turn | the API stays responsive |
| 4 | ✅ A shared pool of model workers fed by every camera (frames counted together) | memory flat as cameras are added |
| 5 | `sharp` instead of `jpeg-js` for JPEG decode / encode | several × less CPU on pictures |
| 6 | A GPU (onnxruntime CUDA) or `MODEL_PATH=ultralytics:…`; or two services: a camera runner on each site's PC, the photo API in the cloud (each camera with one owner) | more hardware, when needed |
| 7 | Load test: seed 10–20 cameras from `test-videos/cameras.json`, record fps and CPU before / after each step | proof |

**The model pool (step 4).** A camera on an ONNX model doesn't load it: `model-pool.ts` gives it a
port of its own (a `MessageChannel`, so frames never pass through the API's thread) to a model worker
(`model.worker.ts`) that holds one copy of the model for every camera on it. Each camera sends its
letterboxed frame and gets the raw output back; it still tidies, tracks and counts itself. A camera
has one frame in flight at most, so frames run in turn; frames that waited meanwhile run as one batch
when the model was exported with a dynamic batch (`MODEL_BATCH`). A worker starts with its first
camera, stops a minute after its last, and is started again for its cameras when it stops on its own
(2 s, 4 s … 60 s apart). `demo:orange` and `ultralytics:` cameras keep their own detector.

| Setting | Default | |
|---|---|---|
| `MODEL_WORKERS` | `1` | model workers per model (cameras spread over them); `0` = a copy of the model in every camera (before step 4) |
| `MODEL_BATCH` | `4` | most frames one run takes (only a model exported with a dynamic batch; `1` = never batch) |
| `MODEL_THREADS` | `0` | CPU threads per copy of the model: cores ÷ (`MODEL_WORKERS` + 1) |

## Counting parcels in photos

Photo counts (Count photos in the warehouse app, `POST /api/v1/counting/photos`, `countingPhotoFolder`) use the **parcel model** when `models/parcel-world-m.onnx` is there: YOLO-World told "parcel, plastic mailer bag, shopping bag, gift bag, cardboard box, package wrapped in plastic", so it finds parcels of any shape in a driver's pickup photos with no training. Overlapping boxes of one parcel and boxes over the floor are dropped, and every box is a "parcel". Make it once with `make export-photo` (about 190 MB; downloads the weights the first time). Without it, photos are counted with the cameras' model.

| Setting | Default | |
|---|---|---|
| `PHOTO_MODEL_PATH` | `models/parcel-world-m.onnx` | another parcel model |
| `PHOTO_MODEL_SIZE` | `1280` | its input size (the export's `imgsz`) |
| `PHOTO_QUEUE_MAX` | `60` | photos that may wait (all users); past it `429` "busy, try again" (`retryAfter` 5 s) |
| `PHOTO_QUEUE_PER_USER` | `20` | photos one user may have waiting; others still get their turn |
| `PHOTO_WORKER` | | `off`: count in the API's own thread (debugging); otherwise a worker thread (`photo.worker.ts`), restarted on the next photo if it crashes |
| `PHOTO_CONF` | `0.01` | its confidence when the app sends none (a parcel half hidden in a pile scores 0.01–0.05; `sortParcels` drops the floor, groups and pieces) |

**Duplicates.** Each photo's result has `skipped` (boxes the model gave but that were not counted: `duplicate` = the same parcel boxed twice, `floor` = a box over most of the photo, `weak` = a weak guess lying on a surer parcel) and a `fingerprint` (a 256-bit difference hash). Photos within 40 bits show the same scene: a folder count marks the later one `copyOf` and leaves it out of the total (`copies`); the app does the same for uploaded photos. Measured on the pickup photos: a copy marked with an X is 16 bits from its original, the same photo sent twice 0, other photos 115–142.

**Records.** A photo uploaded with `batch=<uuid>&seq=<n>` (the app does) and every folder count are saved in `CountingPhotoRecords` (who counted, batch, place, name, count, fingerprint, `copyOfId`). A new photo is compared with the records of the last `PHOTO_DUP_DAYS` days (default 7; 0 = this batch only) that the same account sees (a warehouse: its own): a copy gets `copyOfRecord` (the earlier photo, its batch and time) and is left out of totals. In one batch the photo picked first stays the original, whichever upload finished first. `countingPhotoBatches(from, to)` and `countingPhotoRecords(batchId | copiesOnly, from, to)` list them (the app's Photo records page). With `DB_SYNC=true` the table is created on start; elsewhere create it before deploying.

About 4–5 s a photo on a laptop CPU. Checked on a driver's pickup photos (21 Oct 2026): 3, 4, 5, 5 and 5 whole parcels found as counted by eye, including a parcel wrapped in white paper with no sticker; a parcel cut off at the photo's edge may or may not count.
