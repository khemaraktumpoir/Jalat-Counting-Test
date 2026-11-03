# Jalat Counting Service

Counts parcels that cross a **line** or enter an **area** on a camera over a conveyor or a floor, in
real time, and counts the parcels in **photos** (a driver's pickup, a pile on a mat). The same job as
Ultralytics' `ObjectCounter` (packages on a conveyor belt), built as a Jalat service: several
cameras, live counts for the apps, history, no Python at runtime.

- **NestJS** like the other Jalat services: GraphQL at `/v1`, TypeORM, the same JWT + Redis session
  check, MQTT.
- **ONNX models** run with `onnxruntime-node`; frames read by **ffmpeg** (bundled, `ffmpeg-static`).
- One **worker thread per camera** (`camera.worker.ts`) and the model in a **shared model worker**
  (`model.worker.ts`), so inference never blocks the API; photos in a worker of their own.
- The warehouse app (`app.client/warehouse`, the **Count** tab) is the dashboard.

## Current project status

As of 3 Nov 2026 (the full list, with what blocks each task, is in the [to-do](TODO.md)):

- **Built and on `master`:** live camera counting (line or area, IN / OUT, per class), cameras for
  one or more warehouses with working hours, counting by scanning, photo counts with duplicate
  detection and records, a shared pool of model workers, a fair photo queue. Tested end to end on
  the test videos.
- **Not deployed yet:** the production workflow stops at the Docker build because the repository
  has no GitHub Actions secrets; the database also needs the new columns and table first (no
  `DB_SYNC` in production).
- **Models:** the cameras use `parcel-cam.onnx`, YOLO-World medium fine-tuned on 31 labelled
  pickup photos (8 of 8 validation photos counted exactly); photos use the zero-shot
  `parcel-world-m.onnx`. A fast YOLO26n **belt** model still needs frames from a real belt.
- **First real cameras:** the CAB17 recorder's 8 channels are added, but the recorder refuses
  connections from here, so there is no real belt footage yet.

See also the [training guide](../Jalat-Ultralytics-Service/README.md) and the
[rollout plan](docs/rollout-plan.md).

## How it works

```
ffmpeg (rgb24 frames at the camera's fps, scaled to width × height)
  → letterbox → the ONNX model [1, 300, 6] (shared model worker) → tidy boxes → IoU tracker
  → line / area counter
  → counts: MQTT /topic/counting/<cameraId>/count (live) + CountingSnapshots (deltas every minute)
```

| | Ultralytics `ObjectCounter` | This service |
|---|---|---|
| Region | line (2 points) or polygon (3+) | ✅ line or area, drawn in the app with an IN arrow |
| Detection | any YOLO model, `conf`, `classes` | ✅ any ONNX model with a `[1, 300, 6]` output (YOLO26 end-to-end, YOLO-World with NMS inside); confidence and classes per camera |
| Tracking | several trackers | ✅ IoU tracker (see Counting rules) |
| Counts | IN / OUT | ✅ IN / OUT and per class; counting by scanning (QR codes or taps) beside the cameras |
| Picture | boxes, region, totals | ✅ live view (MJPEG) with region, IN arrow and boxes; a test video's counted copy |
| Output | an annotated video file | ➕ counts saved, hourly / daily history, an overview of every source |
| Run | one process | ➕ many cameras, start / stop / reset, working hours, live counts on MQTT, Jalat sign-in and roles |

## Cameras

| Source | `sourceUrl` | |
|---|---|---|
| Network camera | `rtsp://user:pass@192.168.1.20:554/stream1` | read by ffmpeg; the app's form builds the address from brand, IP, channel and stream |
| Through the relay | `rtsp://go2rtc:8554/cam1_sub` | go2rtc (`COMPOSE_PROFILES=relay`, `deploy/go2rtc.yaml`): one connection per camera, the passwords in that file; also cloud-only cameras (Tapo cloud, XMeye DVRs…) |
| Phone + IP-camera app | `http://<phone ip>:8080/video` (IP Webcam), `:4747/video` (DroidCam) | same Wi-Fi as the service |
| This phone (warehouse app) | `phone:` | the app's "Use this phone's camera" page sends JPEGs to `POST …/frames`; no frame for 10 s → "Waiting for the phone" |
| Counting by scanning | `manual:` | no camera: QR codes or taps in the app (`addManualCount`) |
| Test video | `test-videos/warehouse-zone-by-hand.mp4` | a path on the service (its folder in Docker) |
| This PC's webcam | `rtsp://go2rtc:8554/cam2_sub` | `yarn pc-camera` serves it to the local relay (Windows), on only while a camera watches it |

A camera belongs to one or more warehouses (`warehouseIds`; none = Operation, the hub) and may have
**working hours** (`startTime` / `endTime`, `"HH:mm"` in Phnom Penh time, an end before the start
runs over midnight): an enabled camera then starts and stops on its own.

**Try it with this PC's webcam** (local Docker with the relay running):

1. `yarn pc-camera --list`: the webcams and the sizes they film at.
2. `yarn pc-camera --background` once: the relay asks it for the first webcam (640×360 at 10 fps)
   only while a camera on cam2 runs. `--status` says whether it is on, `--stop` stops it.
3. `DB_HOST=localhost DB_PORT=5433 DB_USERNAME=jalat DB_PASSWORD=jalat yarn db:seed` once: adds
   "PC webcam" (TEST WH 66) with a line down the middle.
4. In the warehouse app: Count → PC webcam → Start. Move a parcel across the line.

The camera model runs on every frame and keeps a laptop's CPU busy; set the camera's detector to
`demo:orange` to try the app with an orange object instead.

### The site camera list (`test-videos/cameras.json`)

Every camera a site counts with, in one file `yarn db:seed` adds to the app: the warehouses'
network cameras and the test videos (which the add-camera form also offers as ready-made cameras).
Each entry is one camera; its name is its key (seeding again changes only its address and detector).

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
2. Add its entry to `cameras.json` and its password to `.env` (`CAM_ZONE_A_PASSWORD=…`, one variable
   per camera). A camera whose password is not set is skipped, with a message.
3. `yarn db:seed` (Docker database: `DB_HOST=localhost DB_PORT=5433 DB_SCHEMA=jalat_counting
   DB_USERNAME=jalat DB_PASSWORD=jalat yarn db:seed`).
4. In the warehouse app (signed in as that warehouse): Count → the camera → check the picture, draw
   its line or area, Start.

The address is built as the app's form builds it (`src/lib/inference/camera-url.ts`, in step with
`app.client/warehouse/src/utils/cameraBrands.ts`). A new IP or password: change the entry or
`.env`, seed again, restart the camera.

## Folders

| | |
|---|---|
| `src/api/` | REST: snapshot, live view, test video, phone frames, photo upload, health, `/` |
| `src/graphql/counting/` | cameras, regions, history, photos (GraphQL); `camera-manager` + a `camera.worker` per camera; `model-pool` + `model.worker`; `photo-queue` + `photo.worker` |
| `src/graphql/auth`, `user` | the Jalat sign-in (JWT + Redis session) and the user model (as the User Service) |
| `src/lib/counting/` | the counting core, no Nest: preprocess, detectors (ONNX, colour, Ultralytics API), box tidying, tracker, line / area counters, drawing |
| `src/lib/inference/` | ffmpeg frames (camera, file, phone), camera addresses, onnxruntime, photos, test videos |
| `src/lib/{config,typeorm,ioredis,jwt,mqtt}` | the service's plumbing, as in the other Jalat services |
| `src/common/`, `entities/`, `repositories/` | shared helpers, the tables, their queries |
| `scripts/` | `db:seed`, `role:seed`, `model:inspect`, `model:bench`, `model:try`, `video:count`, `frames:grab`, `pc-camera` |
| `models/` | the ONNX models and their `.classes.json` (not committed; see Models) |
| `test-videos/` | the test videos and `cameras.json`; `*-counted.mp4` (made by `yarn video:count`) stay out of git |
| `docs/` | `rollout-plan.md`: pilot → data → model → scans → all sites |
| `deploy/` | Docker: `Dockerfile`, `docker-compose.yml` (service + optional Caddy / Cloudflare Tunnel / Redis tunnel / relay), `docker-compose.local.yml` (local Postgres, MQTT, relay), `go2rtc*.yaml`, `README.md` (servers), `setup-server.sh` |
| `.github/workflows/`, `.husky/` | CI/CD to the servers and the commit checks, as in the Location Service |
| `../Jalat-Ultralytics-Service/` | making the models (next to this service, not in it): datasets, training, export — see its `README.md` |

## Run it locally

`make help` lists the everyday commands (`make up`, `make logs`, `make test`, `make model-try`,
`make frames`, `make train-photo` …); from the `jalat-apps` folder, `make counting` starts it in Docker.

```bash
cp .env.example .env          # set JWT_SECRET (the User Service's); DB_SYNC=true creates the tables
docker compose up -d --build  # Postgres :5433, MQTT :1884 (websockets :9002) and the service :9096
                              # (COMPOSE_FILE in .env: deploy/docker-compose.yml + .local.yml); sessions
                              # from this machine's Redis :6379 (the User Service's)
yarn install
yarn start                    # build + node dist/main.js   (or: yarn dev, with watch)
curl localhost:9096/health
```

Without a model the service still runs: cameras stream (snapshot, live view, region editor) and say
`Not counting: Model not found …`. To try everything without a model, set `MODEL_PATH=demo:orange`
(orange boxes found by colour) and seed the test videos with `yarn db:seed`.

**Sign-in:** the warehouse app sends the token it got from the User Service. `JWT_SECRET` and Redis
must be the User Service's, or every Count page says the service didn't accept the sign-in (the
app offers "Sign in again", which only helps once the settings match).

## Models

`models/` holds what the service runs (not committed; on a server, `MODELS_DIR`):

| File | Used by | What it is |
|---|---|---|
| `parcel-cam.onnx` (+ `.classes.json`) | cameras (`MODEL_PATH`) | YOLO-World medium fine-tuned on labelled pickup photos, 640 px |
| `parcel-world-m.onnx` (+ `-l`) | photos (`PHOTO_MODEL_PATH`, default) | zero-shot YOLO-World told the words for a parcel, 1280 px |
| `parcel-embed.onnx` (+ `.json`) | photos | CLIP image encoder: suggests the same parcel in two photos |
| `yolo26n.onnx` + `classes.json` | baseline | pretrained YOLO26n: the 80 COCO objects, **not parcels** |
| `parcel.onnx` | cameras, later | the YOLO26n belt model, once trained on belt frames |

**Making them** happens in `../Jalat-Ultralytics-Service`; these targets hand over to its Makefile,
which writes here:

```bash
make train-photo   # the camera model from labelled photos → parcel-cam.onnx (and parcel-photo.onnx)
make export-photo  # the zero-shot photo model → parcel-world-m.onnx (SIZE=l: large; SIZE=cam: 640 px)
make export-embedder
make split EXPORT=path/to/yolo-export && make train   # the YOLO26n belt model → parcel.onnx
make export        # the pretrained YOLO26n → yolo26n.onnx
```

A model's output must be `[1, 300, 6]` (x1, y1, x2, y2, score, class): YOLO26 exported with
**`nms=False`** (its end-to-end head), or YOLO-World exported with NMS inside. YOLO11's raw
`[1, 84, 8400]` is not supported. Check a model before using it:

```bash
yarn model:inspect models/parcel-cam.onnx                       # its input and output
yarn model:bench models/parcel-cam.onnx --runs 100              # ms a frame on this CPU
yarn model:try models/parcel-cam.onnx test-videos/real-parcels-lane.mp4 --line 650,0,650,720
                                                                # the whole pipeline on a video
```

**Which model for a belt:** YOLO26n. On a CPU it is the fastest (no NMS step, a simpler graph):
measured here 71 ms a frame end to end against YOLO11n's 81–84 ms before its NMS, and about 10×
faster than YOLO-World medium. Parcels on a belt are large, clear objects; try YOLO26s only if it
misses them. Measure on the server's own CPU with `yarn model:bench`.

| `MODEL_PATH` | Detector | |
|---|---|---|
| `models/<file>.onnx` | onnxruntime on this server's CPU | the normal way (`MODEL_PROVIDER=cuda` needs the CUDA build) |
| `demo:orange` | colour | the test videos only: orange boxes by colour, no model |
| `ultralytics:<url>` + `ULTRALYTICS_API_KEY` | Ultralytics Platform over HTTPS | for a site whose server is too weak: every frame crosses the internet (≈100–300 ms), counting stops when it is down; the shared endpoint allows 20 requests a minute (tests only) |

A camera can also have its own detector (`model`: `demo:orange` or `ultralytics`).

> **Licence:** Ultralytics YOLO (and the models made with it) is AGPL-3.0. Settle AGPL vs an
> Enterprise licence before a commercial release ([to-do](TODO.md), Decisions).

## API

GraphQL (`/v1`), roles `ADMIN`, `OPERATION`, `MOBILE_WAREHOUSE` (a warehouse sees only its own
cameras and photos); with a role, its `COUNTING:*` permissions decide what each account may do.

| Query / mutation | |
|---|---|
| `countingCameras`, `countingCamera(id)` | cameras with `region` and `runtime` (status, fps, error, in / out since reset) |
| `createCountingCamera`, `updateCountingCamera`, `deleteCountingCamera` | settings include `warehouseIds`, `startTime` / `endTime`, `model` |
| `startCountingCamera`, `stopCountingCamera`, `resetCountingCamera` | reset saves the counts, then counts from 0 |
| `saveCountingRegion(cameraId, type: LINE \| POLYGON, points)` | LINE: 2 points; POLYGON: 3+; inside width × height |
| `countingHistory(cameraId, from, to, bucket: HOUR \| DAY)` | counts per hour / day (Phnom Penh); the current hour includes unsaved counts |
| `countingOverview(from, to, bucket)` | every visible source in a time range, per hour or day: cameras vs counting by scanning |
| `addManualCount(input: { cameraId, code?, delta })`, `countingManualScans(cameraId, limit)` | counting by scanning (`manual:`): a QR code counts once since the last reset, no code = a tap, `delta: -1` takes one back |
| `countingClasses`, `countingModel`, `countingPermissions` | the model's labels; whether it is loaded; what this account may do |
| `countingTestVideos`, `countingTestVideoPresets` | the test videos on the service, and the ready-made cameras of `cameras.json` |
| `countingPhotoModel`, `countingPhotoRoots`, `countingPhotoFolder(path, …)` | what counts photos; the folders it may read (`PHOTO_ROOTS`); count a folder on the service |
| `countingPhotoBatches(from, to)`, `countingPhotoRecords(batchId \| copiesOnly, …)` | batches of counted photos, and one batch's photos or the copies |
| `namePhotoBatch`, `deletePhotoBatch`, `correctPhotoCount`, `markPhotoRepeats` | name a batch, delete one counted by mistake, fix a photo's count by hand, mark parcels an earlier photo already shows |

REST (token as `Authorization: Bearer …` or `?access_token=`, for `<img>` and `<video>`; never
written to the log):

- `GET /api/v1/counting/cameras/:id/snapshot` — one JPEG (the running camera's last frame, or one grabbed)
- `GET /api/v1/counting/cameras/:id/stream` — MJPEG live view with the region, the IN arrow and the
  boxes (at most 5 fps, 640 px)
- `GET /api/v1/counting/cameras/:id/video` — a test-video camera's video (`?counted=1`: its counted
  copy), with seeking
- `POST /api/v1/counting/cameras/:id/frames` — a phone camera (`phone:`): one JPEG (up to 3 MB,
  scaled to the camera's size); 409 when the camera is off
- `POST /api/v1/counting/photos?name=&conf=&classes=&batch=&seq=` — one uploaded photo (`image/jpeg`):
  its count by label and the boxes; 429 with `retryAfter` when the queue is full
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
- **Boxes** are tidied first, as for photos (`src/lib/counting/tidy.ts`): the same parcel boxed
  twice, a box over most of the picture and a weak guess on a surer parcel are dropped.
- **Tracker**: greedy IoU matching per class (`iouThreshold` 0.3), a track survives 10 missed frames.
- **Storage**: counts are saved as deltas every minute (when something was counted), on stop and on
  reset, so a restart never doubles them and a crash loses at most a minute; "since reset" = saved
  since `countsResetAt` + what the running worker counted.

## Counting parcels in photos

Photo counts (the warehouse app's Count → Photos, `POST /api/v1/counting/photos`,
`countingPhotoFolder`) use the **parcel model** when `models/parcel-world-m.onnx` is there (else
`parcel-world-l.onnx`, else the cameras' model): every box is a parcel, whatever its shape.

| Setting | Default | |
|---|---|---|
| `PHOTO_MODEL_PATH` | `models/parcel-world-m.onnx` | another parcel model |
| `PHOTO_MODEL_SIZE` | `1280` | its input size (the export's `imgsz`) |
| `PHOTO_CONF` | `0.01` | its confidence when the app sends none (a parcel half hidden in a pile scores 0.01–0.05; the tidying drops the floor, groups and pieces) |
| `PHOTO_ROOTS` | `photos,test-videos` | the folders `countingPhotoFolder` may read |
| `PHOTO_QUEUE_MAX` | `60` | photos that may wait (all users); past it `429` "busy, try again" (`retryAfter` 5 s) |
| `PHOTO_QUEUE_PER_USER` | `20` | photos one user may have waiting; others still get their turn |
| `PHOTO_DUP_DAYS` | `7` | how far back a new photo is compared for copies (0 = this batch only) |
| `PHOTO_WORKER` | | `off`: count in the API's own thread (debugging); otherwise a worker thread, restarted on the next photo if it crashes |

**Duplicates.** Each photo's result has `skipped` (boxes not counted: `duplicate`, `floor`, `weak`)
and a `fingerprint` (a 256-bit difference hash). Photos within 40 bits show the same scene: the
later one is marked `copyOf` and left out of the total. Measured on pickup photos: a copy is about
16 bits from its original, the same photo sent twice 0, other photos 115–142.

**Records.** A photo uploaded with `batch=<uuid>&seq=<n>` (the app does) and every folder count are
saved in `CountingPhotoRecords` (who, batch, place, name, count, fingerprint, `copyOfId`). A new
photo is compared with the records of the last `PHOTO_DUP_DAYS` days the same account sees; a copy
gets `copyOfRecord` and is left out of totals. Create the table before deploying (no `DB_SYNC` in
production).

About 4–5 s a photo on a laptop CPU.

## Scaling: many cameras and users

Now: one worker thread per camera (ffmpeg, letterbox, tidying, tracking, counting), the model in a
shared model worker, photos in a worker of their own. Measured on a dev PC (28 Oct 2026): one camera
on a YOLO-World medium model ≈ 1,370 % CPU, on `demo:orange` ≈ 140 %.

| Step | What | Gain |
|---|---|---|
| 1 | Settings: `MODEL_THREADS` = CPU cores ÷ (`MODEL_WORKERS` + 1 for photos); cameras on their small stream at 5–10 fps | cameras stop fighting over cores |
| 2 | A YOLO26n parcel model trained on the site's footage | ~10× faster than YOLO-World medium |
| 3 | ✅ Photo counts in a worker of their own, a bounded queue, each user in turn (29 Oct 2026) | the API stays responsive |
| 4 | ✅ A shared pool of model workers fed by every camera (29 Oct 2026) | memory flat as cameras are added |
| 5 | `sharp` instead of `jpeg-js` for JPEG decode / encode | several × less CPU on pictures |
| 6 | A GPU (onnxruntime CUDA) or `MODEL_PATH=ultralytics:…`; or two services: a camera runner on each site's PC, the photo API in the cloud | more hardware, when needed |
| 7 | Load test: seed 10–20 cameras from `test-videos/cameras.json`, record fps and CPU before / after each step | proof |

**The model pool.** A camera on an ONNX model doesn't load it: `model-pool.ts` gives it a port of
its own (a `MessageChannel`, so frames never pass through the API's thread) to a model worker that
holds one copy of the model for every camera on it. Each camera sends its letterboxed frame and gets
the raw output back; it still tidies, tracks and counts itself. A camera has one frame in flight at
most, so frames run in turn; frames that waited meanwhile run as one batch when the model has a
dynamic batch. A worker starts with its first camera, stops a minute after its last, and is started
again when it stops on its own (2 s, 4 s … 60 s apart). `demo:orange` and `ultralytics` cameras keep
their own detector.

| Setting | Default | |
|---|---|---|
| `MODEL_WORKERS` | `1` | model workers per model; `0` = a copy of the model in every camera |
| `MODEL_BATCH` | `4` | most frames one run takes (only a model with a dynamic batch; `1` = never batch) |
| `MODEL_THREADS` | `0` | CPU threads per copy of the model: cores ÷ (`MODEL_WORKERS` + 1) |

## Tests

```bash
yarn test     # 151 tests (3 Nov 2026): preprocessing, parsing, tracker, line and area counters,
              # the pipeline and the sample video end to end (7 parcels by hand, ± 1), the camera
              # manager, model pool, photo queue, rules and repository
```

## Deploy

**`deploy/README.md`** has the steps, server sizes and daily commands. In short: `deploy/Dockerfile`
(Node 20, two stages, non-root, health check; ffmpeg from ffmpeg-static); mount the models at
`/usr/src/models`; point `MQTT_*` at the apps' broker, `REDIS_*` at the User Service's Redis
(sessions) and `JWT_SECRET` at its secret.

- **A cloud server or a PC next to the cameras:** `deploy/docker-compose.yml` with optional parts
  (`COMPOSE_PROFILES`): `https` (Caddy), `cloudflare` (Cloudflare Tunnel), `redis-tunnel` (Redis
  over SSH), `relay` (go2rtc). `deploy/setup-server.sh` prepares a fresh server. On a small server
  set `MODEL_THREADS` and `COUNTING_MEM_LIMIT`.
- **The servers, as the other Jalat services:** `.github/workflows` — a push to `development`,
  `uat` or `master` builds the image, pushes it to Huawei SWR, reads the settings from Huawei CSMS
  (`scripts/fetch_csms_secrets.js`) and updates the Docker Swarm service over SSH. **Until the
  repository has these secrets, the workflow stops at the Docker build** (see the [to-do](TODO.md)).

| Workflow | Branch | GitHub secrets / vars |
|---|---|---|
| `development.yml` | `development` | `IMAGE_NAME`, `REGISTRY`, `REGION`, `SWR_ORG_NAME`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `KMS_*`, `HUAWEI_PRIVATE_KEY`, `USERNAME`, `HOSTNAME`, `SWR_LOGIN_KEY`, `DOCKER_SERVICE_NAME`, `DOCKER_NETWORK_NAME`; var `SERVICE_REPLICA` (as the Location Service, with this service's own image, service name and CSMS secret) |
| `uat.yml` | `uat` | the same names with `UAT_` in front (var `UAT_SERVICE_REPLICA`) |
| `production.yml` | `master` | the same names with `PROD_` in front (var `PROD_SERVICE_REPLICA`) |

The CSMS secret holds the service's settings (`.env` names) plus `PORT_COUNTING` (the published
port, e.g. 9096) and `MODELS_DIR` (the server folder with the models, mounted read-only at
`/usr/src/models`). Production runs without `DB_SYNC` and there are no migrations: create new
columns and tables before deploying. Keep **one replica** per set of cameras: each replica runs
every enabled camera.

**Commits:** `.husky` runs `lint-staged` (eslint + prettier on the staged files) before a commit and
commitlint (`.commitlintrc.json`, Angular: `feat(counting): …`, a title of 72 characters at most) on
the message; `yarn install` turns the hooks on.

## Not done yet

The [to-do](TODO.md) is the checklist. In short:

- **Deploy:** GitHub Actions secrets, the CSMS secret, the database columns, the models on the server.
- **A real belt:** a reachable pilot camera, then frames, labels and a YOLO26n belt model with its
  `yarn model:bench` numbers on the pilot machine.
- **Scaling** steps 1, 5 and 7 (thread settings, `sharp`, a load test).
- **Later:** an annotated video per camera, tracker choices (ByteTrack / BoT-SORT), several regions
  per camera, CSV export.
