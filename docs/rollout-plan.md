# Parcel counting: rollout plan

What it is for: count the parcels that pass each conveyor belt in a Jalat warehouse, live, so the
warehouse can check its scans against what physically moved — and see where parcels are missed.

Status (2026-10-20): the service, the warehouse app's Count tab, phone cameras and the model
tooling work end to end on the test video. **Missing: a model trained on parcels** (the pretrained
YOLO26n detects nothing on a belt) and a first real camera.

## 1. Goal and success measures

| Measure | Target | How it is checked |
|---|---|---|
| Counting accuracy | within ±2 % of a hand count, per belt per hour | 3 recordings × 30 min per belt, counted by hand |
| Missed / double counts | < 1 in 100 parcels | the same recordings, parcel by parcel |
| Live delay | count on screen < 2 s after the parcel crosses | MQTT timestamp vs video |
| Uptime | a camera counting ≥ 99 % of working hours | camera status history (RUNNING vs RECONNECTING / ERROR) |
| Scan reconciliation | the gap between counted and scanned parcels is explained daily | report (phase 4) |

## 2. Who uses it

| Role | Uses |
|---|---|
| Warehouse staff (`MOBILE_WAREHOUSE`) | Count tab: cameras of their warehouse, live counts, starts / stops a phone camera |
| Operation (`OPERATION`) | all cameras, history per hour / day, sets up cameras and counting lines |
| Admin (`ADMIN`) | everything; later the scan-vs-count report |

## 3. Phases

| Phase | What | Done when | Effort |
|---|---|---|---|
| **0. Pilot site** | Pick one warehouse and one belt (the busiest inbound). Mount a camera over it, or a spare phone (IP Webcam / "Use this phone's camera"). Run the service on a PC there (`deploy/docker-compose.yml`, deploy/README.md). | live view of the real belt in the Count tab | 1–2 days |
| **1. Data** | `yarn frames:grab --camera <id>` over 3–5 days: mornings / evenings, busy / quiet; 500–1,000 frames. Label in Ultralytics Platform (SAM auto-boxes) or CVAT: class `parcel`. | 500+ labelled frames, 20 % held out | 3–5 days (labelling ≈ 1 frame / 20 s) |
| **2. Model** | `train_parcels.py` (YOLO26n; on a GPU via Colab or Platform: minutes). `yarn model:try` on 3 held-out recordings vs hand counts. Iterate on the misses. | mAP50 ≥ 0.9 and counts within ±2 % | 1 week |
| **3. Pilot run** | `MODEL_PATH=models/parcel.onnx` on the pilot belt for 2 weeks; staff report misses; daily check of status and fps. | 2 weeks within target, no unplanned stop > 30 min | 2 weeks |
| **4. Link to scans** | A daily / hourly report: parcels counted on a belt vs parcels scanned at that point (Order Service scan logs), with the gap. Needs: which scan step each belt matches. | Operation reads the gap each day | 1–2 weeks (Order Service + app) |
| **5. Roll out** | Every belt of the pilot warehouse, then the other warehouses; one service (PC or server) per site; CI/CD (`.github/workflows`) for the server copies. | all planned belts counting | 1 week per site |

## 4. Hardware per belt

| Choice | Cost | Notes |
|---|---|---|
| IP camera (PoE, 1080p, fixed lens) above the belt, looking down | low | the steady option; RTSP; no daylight glare on the lens |
| Spare Android phone + IP Webcam app, on a mount, always charging | very low | good for the pilot; Wi-Fi must be steady |
| A phone with the warehouse app ("Use this phone's camera") | none | quickest to try; the page must stay open (https only) |

**Compute:** YOLO26n runs at ~14 fps on a 12-thread PC (71 ms a frame); a belt needs 5–10 fps, so
one mid-range PC handles 1–2 belts on CPU. More belts: a stronger CPU, a small GPU (CUDA build of
onnxruntime), or an Ultralytics dedicated endpoint (`MODEL_PATH=ultralytics:…`) where the
internet is good.

**Mounting:** straight down or steep, the whole belt width in view, the counting line across the
belt where parcels are apart (after a gap-making roller if there is one), even light (add an LED
strip if the area is dark).

## 5. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Parcels touching / stacked | two parcels counted as one | camera steeper; a line after a spacing point; more training frames of crowded belts |
| Light changes (sun, night) | missed parcels at some hours | frames from all hours in the dataset; a fixed light over the belt |
| Camera moved / bumped | the line no longer across the belt | a fixed mount; the live view checked at the start of each shift; status alerts |
| Network / PC down | no counts for that time | the service restarts itself (Docker `unless-stopped`); counts saved every minute; uptime in the status |
| Licence | Ultralytics YOLO is AGPL-3.0 | decide AGPL vs an Ultralytics Enterprise licence before a commercial release |
| Privacy | workers in the frame | point the camera at the belt only; frames stay on the site (local model) |

## 6. Open questions

1. Which warehouse and belt for the pilot, and who on site owns the camera?
2. Counts at which point — inbound, sorting, outbound — and which scan step does each match?
3. Count all parcels as one class, or tell boxes / bags / envelopes apart?
4. A PC per site, or one server for all sites (needs each site's camera over VPN or a tunnel)?
5. Who labels the frames (in-house, or a labelling service)?
