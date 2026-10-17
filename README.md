# Jalat Counting Service

Counts parcels (or any object the model knows) that cross a **line** or enter an **area** on a
camera — an IP / RTSP camera over a conveyor, or a video file — in real time.

- **NestJS** like the other Jalat services (GraphQL at `/v1`, TypeORM, the same JWT + Redis
  session check, MQTT), **no Python at runtime**.
- **YOLO26** exported once to **ONNX**, run with `onnxruntime-node`; frames read by **ffmpeg**
  (bundled with `ffmpeg-static`).
- One **worker thread per camera** (`src/graphql/counting/camera.worker.ts`), so inference never
  blocks the API.
- The warehouse app (`app.client/warehouse`, Profile → Parcel counting) is the dashboard.

```
ffmpeg (rgb24 frames at the camera's fps, scaled to width × height)
  → letterbox 640×640 → YOLO26 ONNX [1, 300, 6] → IoU tracker → line / area counter
  → counts: MQTT /topic/counting/<cameraId>/count (live) + CountingSnapshots (hourly deltas)
```

## Run it locally

```bash
docker compose up -d          # Postgres :5433, Redis :6380, MQTT :1884 (websockets :9002)
cp .env.example .env          # set JWT_SECRET; DB_SYNC=true creates the tables
yarn install
yarn build && node dist/main.js   # or: yarn dev
curl localhost:9096/health
```

Without a model the service still runs: cameras stream (snapshot, live view, region editor) and say
`Not counting: Model not found …`. To try everything without a model, set
`MODEL_PATH=demo:orange` — orange boxes are found by colour (`ColorDetector`) — and use the sample:

```bash
yarn db:seed                  # "Sample conveyor" on samples/conveyor-synthetic.mp4, line across the belt
```

## Model

YOLO26 is exported to ONNX once, outside this repo (the only Python step):

```bash
pip install ultralytics
yolo export model=yolo26n.pt format=onnx imgsz=640      # or your own parcel model (best.pt)
```

Put the file in `models/` (not committed) and check it:

```bash
yarn model:inspect models/yolo26n.onnx
# expects an NMS-free output [1, 300, 6] = x1, y1, x2, y2, score, class
```

`models/classes.json` maps class index → label: the 80 COCO labels for `yolo26n`; replace it with
your own labels for a custom parcel model (`["parcel"]`). `MODEL_PROVIDER=cuda` needs the CUDA build
of onnxruntime-node.

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

REST (token as `Authorization: Bearer …` or `?access_token=`, for `<img>`):

- `GET /api/v1/counting/cameras/:id/snapshot` — one JPEG (the running camera's last frame, or one grabbed)
- `GET /api/v1/counting/cameras/:id/stream` — MJPEG live view with the region, the IN arrow and the boxes
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
- **Storage**: counts are saved as deltas every hour, on stop and on reset, so a restart never loses
  or doubles them; "since reset" = saved since `countsResetAt` + what the running worker counted.

## Tests

```bash
yarn test     # the core: preprocessing, parsing, tracker, line and area counters, pipeline,
              # and the sample video end to end (7 parcels by hand, ± 1)
```

## Deploy

`Dockerfile` (Node 20, Debian slim; ffmpeg comes with ffmpeg-static). Mount the model:
`-v /srv/models:/usr/src/models`. Point `MQTT_*` at the broker the apps listen to, `REDIS_*` at the
User Service's Redis (sessions) and `JWT_SECRET` at its secret.

## Not done yet

- A real YOLO26 / parcel model and its benchmark (ms per frame on the server's CPU) — needs the
  ONNX export.
- Load test with many cameras; ByteTrack for crowded scenes; several regions per camera; CSV export.
