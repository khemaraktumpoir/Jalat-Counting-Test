#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu / Debian server (e.g. a 1 vCPU / 2 GB VPS) for the counting
# service: Docker, 2 GB of swap, a firewall, and the folders. Run as root, once:
#
#   curl -fsSL <raw url of this file> | sudo bash        or   sudo bash deploy/setup-server.sh
#
# Then copy the repo (or only deploy/ + the image), the model into /srv/counting/models, and
# .env (deploy/README.md).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo bash $0)." >&2
  exit 1
fi

# ---- Docker (the official script; skipped when it is there) ----
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# ---- 2 GB swap: a build or a busy moment must not kill the service on 2 GB of RAM ----
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
# Use the swap only when RAM is really short.
sysctl -w vm.swappiness=10 >/dev/null
grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf

# ---- Firewall: SSH, and HTTP / HTTPS for Caddy (the service itself listens on 127.0.0.1) ----
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

# ---- Folders: the model (mounted read-only into the container) ----
mkdir -p /srv/counting/models

echo
echo "Ready: $(docker --version), swap $(free -h | awk '/Swap/ {print $2}'), /srv/counting/models"
echo "Next: put the model in /srv/counting/models, fill .env (COMPOSE_FILE=deploy/docker-compose.yml, MODELS_DIR=/srv/counting/models),"
echo "      docker compose up -d   (from the repo root) — see deploy/README.md"
