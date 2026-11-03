# Jalat Counting Service — To-do

Where the service stands and what comes next, in the order of the [rollout plan](docs/rollout-plan.md).
**Blocked** marks a task waiting on something outside the code (a person, a decision, access).
Last updated 3 Nov 2026.

## Now: get it deployed

The code is on `master` (37675e1, 3 Nov 2026), but the production workflow stops at "Build the
docker image": the repository has no GitHub Actions secrets, so the image name is empty. Nothing
has been deployed.

- [ ] **Add the GitHub secrets** — **blocked: repository admin.** Settings → Secrets and variables
  → Actions: the `PROD_` names in `.github/workflows/production.yml` (`PROD_IMAGE_NAME`,
  `PROD_REGISTRY`, `PROD_SWR_ORG_NAME`, `PROD_REGION`, `PROD_ACCESS_KEY_ID`,
  `PROD_SECRET_ACCESS_KEY`, `PROD_KMS_*`, `PROD_HUAWEI_PRIVATE_KEY`, `PROD_USERNAME`,
  `PROD_HOSTNAME`, `PROD_SWR_LOGIN_KEY`, `PROD_DOCKER_SERVICE_NAME`, `PROD_DOCKER_NETWORK_NAME`) and
  the variable `PROD_SERVICE_REPLICA`. The same with `UAT_` / no prefix for `uat` / `development`.
- [ ] **Fill the CSMS secret** with the service's `.env` settings, `PORT_COUNTING` (e.g. 9096) and
  `MODELS_DIR` (e.g. `/srv/counting/models`). `JWT_SECRET` and `REDIS_*` must be the User
  Service's, or the warehouse app shows "the counting service didn't accept your sign-in".
- [ ] **Prepare the database.** Production runs without `DB_SYNC`, and there are no migrations:
  before the first deploy, create the columns and table added since the last schema
  (`CountingCameras.warehouseIds`, `startTime`, `endTime`; `CountingPhotoRecords`), or start once
  with `DB_SYNC=true` on an empty database.
- [ ] **Copy the models** to the server's `MODELS_DIR`: `parcel-cam.onnx` (+ `.classes.json`) for
  the cameras, `parcel-world-m.onnx` and `parcel-embed.onnx` (+ `.json`) for photos.
- [ ] **Re-run the workflow** and check `/health` (database, model, MQTT, enabled cameras).

## Cameras

- [x] Sources: RTSP cameras (address built from brand, IP, user, password, channel), the local
  go2rtc relay, a phone with an IP-camera app, the warehouse app's own camera, video files.
- [x] A camera can belong to several warehouses (`warehouseIds`), and has working hours
  (`startTime` / `endTime`, Asia/Phnom_Penh, overnight allowed).
- [x] Added locally (3 Nov 2026): the CAB17 recorder's 8 channels as "CAB17 · Channel 1–8"
  (`rtsp://…@cab17.cellcard.com.kh:554/Streaming/Channels/N01`, TEST WH 66, all off).
- [ ] **Reach the CAB17 recorder** — **blocked: whoever manages the recorder / Cellcard line.**
  `cab17.cellcard.com.kh` (203.144.76.16) refused ports 554, 80, 443 and 8000 from the office PC
  and from Docker on 3 Nov 2026: offline, an IP allow-list, or no port forward on its router.
- [ ] **Check "Belt 14"'s address** once the recorder answers: `…/Channels/40102` is not
  Hikvision's usual form (`401` main, `402` small stream of channel 4).
- [ ] **Choose the pilot site and belt**, name the on-site camera owner, and the scan step its
  counts will be compared with (inbound, sorting or outbound).
- [ ] **Check the pilot camera:** the whole belt in view, enough light, the line or area in the
  right place, connected through a full working day.

## Parcel model

- [x] **Photo model** (warehouse app Count → Photos): zero-shot YOLO-World medium
  (`parcel-world-m.onnx`), checked on drivers' pickup photos (21 and 27 Oct 2026).
- [x] **Camera model from real photos** (30 Oct 2026): YOLO-World medium fine-tuned on 31 labelled,
  checked pickup photos (`../Jalat-Ultralytics-Service/runs/photo-m`): mAP50 0.927, 8 of 8
  validation photos counted exactly (the zero-shot model: 4 of 8, 7 parcels off). In use as
  `MODEL_PATH=models/parcel-cam.onnx`.
- [x] Tried and dropped (30 Oct 2026): 150 synthetic recoloured pictures and strong colour shifts,
  to make the model ignore colour — both counted worse. More real, varied photos work better.
- [ ] **More real photos:** 200 or more, from different drivers, mats, light and pile sizes
  (whole piles in either train or val, never both), then train again with `make train-photo`.
- [ ] **Belt frames** — **blocked: a reachable pilot camera.** 500–1,000 frames over 3–5 days
  (busy and quiet, morning and evening) with `yarn frames:grab --camera <id>`.
- [ ] **Label and train a YOLO26n belt model** (`make split`, `make label`, `make train` in
  `../Jalat-Ultralytics-Service`): about 10× faster than YOLO-World medium on a CPU.
- [ ] **Evaluate it** on three held-out recordings against hand counts: mAP50 ≥ 0.9, counts
  within ±2%.
- [ ] **Benchmark on the pilot hardware** (`yarn model:bench`) and confirm it keeps up with the
  belt's frame rate.

## Scaling (README "Scaling: many cameras and users")

- [x] Step 3: photo counts in a worker of their own, a fair queue (each user in turn, `429` when
  full) — 29 Oct 2026.
- [x] Step 4: a shared pool of model workers for the cameras, memory flat as cameras are added —
  29 Oct 2026.
- [ ] Step 1: set `MODEL_THREADS` (cores ÷ (`MODEL_WORKERS` + 1)) and the cameras' small stream at
  5–10 fps on the pilot machine.
- [ ] Step 5: `sharp` instead of `jpeg-js` for JPEG decode / encode.
- [ ] Step 7: load test — seed 10–20 cameras from `test-videos/cameras.json`, record fps and CPU.

## Pilot run and rollout

- [ ] **Two-week pilot** on the chosen belt; staff report misses; check camera status and fps daily.
- [ ] **Record the results:** counts within ±2%, under 1 missed or double count per 100, live delay
  under 2 s, camera up ≥ 99% of working hours; look into any stop longer than 30 minutes.
- [ ] **Scan reconciliation:** an hourly or daily counted-versus-scanned report, once the scan step
  is agreed.
- [ ] **Roll out** to the pilot warehouse's other belts, then to other warehouses.

## Decisions

- [ ] One class (`parcel`) or boxes, bags and envelopes apart.
- [ ] Who labels the photos and belt frames.
- [ ] A local PC per site or a shared server (each camera has one owner either way).
- [ ] How to meet Ultralytics' AGPL-3.0 licence before a commercial release.

## Housekeeping

- [ ] Remove models no setting uses from `models/` (`parcel-world-m-nms04.onnx`,
  `parcel-photo-m640.onnx`, `parcel-world-cam.onnx` once `parcel-cam.onnx` is confirmed).
- [ ] `yarn test`: one test leaves a worker running ("failed to exit gracefully"); find it with
  `--detectOpenHandles`.
- [ ] Ultralytics' global `settings.json` still points `weights_dir` / `runs_dir` at the old
  `Jalat-Counting-Service/training/` folder (378 MB, holds YOLO-World's CLIP weights): move it to
  `../Jalat-Ultralytics-Service`, then delete `training/`.

## Later (not needed for the pilot)

- [ ] Record an annotated video of a camera (the counted test videos are made offline today with
  `yarn video:count`).
- [ ] Tracker choices (ByteTrack / BoT-SORT) for crowded belts.
- [ ] Several counting regions per camera.
- [ ] CSV export of counts and photo records.
