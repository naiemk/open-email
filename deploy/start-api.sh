#!/usr/bin/env bash
# Relayer on vps-edge only (no host :8080). Secrets via --env-file .env.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# shellcheck source=lib-env.sh
[[ -f lib-env.sh ]] && source lib-env.sh && load_dotenv .env

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

IMAGE="${BACKEND_IMAGE:-ghcr.io/naiemk/open-email-api:main}"
NAME="${DOCKER_NAME:-open-email-api}"
NETWORK="${DOCKER_NETWORK:-vps-edge}"
MEMORY="${API_MEMORY_LIMIT:-256m}"

if [[ "${PULL:-1}" == "1" && "$IMAGE" != *:local ]]; then
  echo "Pulling $IMAGE ..."
  docker pull "$IMAGE"
fi

docker network create "$NETWORK" >/dev/null 2>&1 || true

if docker inspect "$NAME" >/dev/null 2>&1; then
  echo "Removing existing container $NAME ..."
  docker rm -f "$NAME" >/dev/null
fi

ENV_ARGS=()
[[ -f .env ]] && ENV_ARGS+=(--env-file .env)

echo "Starting $NAME on network $NETWORK (no host port) ..."
# shellcheck disable=SC2046
docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  --network "$NETWORK" \
  --label "vibed.managed=1" \
  --label "vibed.role=api" \
  $(memory_args "$MEMORY") \
  "${ENV_ARGS[@]}" \
  -e BIND_HOST=0.0.0.0 \
  -e PORT=8080 \
  "$IMAGE" >/dev/null

echo "Relayer $NAME up on $NETWORK:8080"
