# Deploying the counting service

Every Docker file is in this folder; run `docker compose` from the repo root (the settings are the root
`.env`, whose `COMPOSE_FILE` points here). Three ways, by where the service runs. All use the same image (`Dockerfile` here: Node 20, about
720 MB, runs as the non-root `node` user, a built-in health check) and the shared Jalat database,
Redis (sign-ins) and MQTT broker.

| | Where | Reached by | Files |
|---|---|---|---|
| **A. A cloud server (VPS)** | e.g. a 1–2 vCPU droplet | HTTPS on your domain (Caddy) | `docker-compose.yml`, profile `https` |
| **B. A PC at the warehouse** | next to the cameras, on their network | Cloudflare Tunnel (no open port) | `docker-compose.yml`, profile `cloudflare` |
| **C. The Jalat servers** | Docker Swarm, like the other services | the servers' own routing | `../.github/workflows` (push to `development` / `uat` / `master`) |

**Cameras:** a cloud server (A, C) cannot open an RTSP camera on the warehouse network. There it
counts phone cameras ("Use this phone's camera" sends frames over HTTPS) and video files; RTSP
cameras need B, or a VPN / tunnel from the site.

## How big a server

Measured with `yarn model:bench --threads N` (YOLO26n, 640 px) on a desktop CPU; a cloud vCPU is
usually somewhat slower. A belt needs about 5 frames a second.

| Server | YOLO26n per frame | Cameras with the model | Settings |
|---|---|---|---|
| 1 vCPU / 2 GB (≈ $12) | ≈ 210–300 ms → 3–5 fps | **1** (dev, a pilot) | `MODEL_THREADS=1`, `DEFAULT_FPS=5`, `COUNTING_MEM_LIMIT=1500m`, swap on |
| 2 vCPU / 4 GB (≈ $24) | ≈ 60–90 ms → 11–17 fps | 2 | `MODEL_THREADS=1` (one core each) or `2` with one camera, `COUNTING_MEM_LIMIT=3g` |
| 4 vCPU / 8 GB | | 3–4 | `MODEL_THREADS=1`, `COUNTING_MEM_LIMIT=6g` |
| a PC on site (B) | ≈ 50 ms (12 threads) | 4+ | `MODEL_THREADS` = cores ÷ cameras |

Each camera is its own worker with its own model (≈ 250–300 MB of RAM). With `demo:orange` (no
model) any server works. Do not build the image or train a model on a 2 GB server: build in CI or
on a PC (`COUNTING_IMAGE`), train on a PC or a GPU (`../training/README.md`).

## A. A cloud server, step by step

```bash
# 1. On the new server (Ubuntu / Debian), once: Docker, 2 GB swap, firewall (22, 80, 443), folders
sudo bash deploy/setup-server.sh

# 2. The code (or only deploy/, with a ready image: COUNTING_IMAGE in .env)
git clone <the counting repo> /srv/counting/app && cd /srv/counting/app

# 3. The model, from your PC
scp models/yolo26n.onnx models/classes.json root@<server>:/srv/counting/models/

# 4. The settings
cp .env.example .env && nano .env
#    COMPOSE_FILE=deploy/docker-compose.yml  (the .local.yml one is for local development)
#    COMPOSE_PROFILES=https, DOMAIN=counting-dev.jalatlogistics.com (its DNS A record → this server),
#    MODELS_DIR=/srv/counting/models, JWT_SECRET, DB_*, REDIS_*, MQTT_* (as the other services)

# 5. Start
docker compose up -d --build
curl -s https://counting-dev.jalatlogistics.com/health
```

Then in the warehouse app's build: `VITE_COUNTING_SERVICE_URL=https://counting-dev.jalatlogistics.com/v1`.

## B. A PC at the warehouse

The same, with `COMPOSE_PROFILES=cloudflare` and a tunnel token: Cloudflare Zero Trust → Networks →
Tunnels → Create → copy the token into `TUNNEL_TOKEN`; add a public hostname
(`counting-site1.jalatlogistics.com`) → service `http://counting:9096`. No port is opened on the
router. Add `redis-tunnel` to the profiles when the Redis server accepts connections from itself
only (`SSH_TARGET`, `SSH_KEY_FILE`).

## Every day

```bash
cd /srv/counting/app
docker compose ps            # running, healthy?
docker compose logs -f counting --tail 100
git pull && docker compose up -d --build   # update
docker stats --no-stream                                   # memory / CPU per container
```

- **A new model:** copy it into `MODELS_DIR`, set `MODEL_PATH` if the name changed, then
  `docker compose restart counting` (the cameras reload it).
- **Back to the last version:** `git checkout <previous commit>` and `up -d --build`; with a
  registry image, set `COUNTING_IMAGE` to the previous tag and `up -d --no-build`.
- **Logs** rotate at 10 MB × 3 per container; counts are in the database, not the logs.
- **Health:** `/health` (database, model, MQTT, cameras). Docker marks the container unhealthy after
  3 failed checks; `restart: unless-stopped` brings it back after a crash or a reboot.

## Files

| | |
|---|---|
| `Dockerfile`, `Dockerfile.dockerignore` | the image (two stages, non-root, health check) and what the build leaves out (`training/`, `node_modules`, `.env`…) |
| `docker-compose.yml` | the service + the optional parts (profiles); the same file everywhere |
| `docker-compose.local.yml` | local development only: a Postgres and an MQTT broker |
| `../.env.example` | every setting; copy to `../.env` (the small-server values are in its comments) |
| `setup-server.sh` | one-time server setup |
| `ssh_key`, `../.env` | yours, never committed (`.gitignore`, `Dockerfile.dockerignore`) |
