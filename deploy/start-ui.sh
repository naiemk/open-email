#!/usr/bin/env bash
# Node HTTP on vps-edge:80 (gateway proxies) + SMTP published on host :25. DAL in a named volume.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# shellcheck source=lib-env.sh
[[ -f lib-env.sh ]] && source lib-env.sh && load_dotenv .env

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

NETWORK="${DOCKER_NETWORK:-vps-edge}"
UI_NAME="${UI_NAME:-open-email-ui}"
UI_IMAGE="${UI_IMAGE:-ghcr.io/naiemk/open-email-ui:main}"
UI_MEMORY="${UI_MEMORY_LIMIT:-512m}"

if [[ "${PULL:-1}" == "1" && "$UI_IMAGE" != *:local ]]; then
  echo "Pulling $UI_IMAGE ..."
  docker pull "$UI_IMAGE"
fi

docker network create "$NETWORK" >/dev/null 2>&1 || true

vibed_resolve_data_storage "$UI_NAME" "ui"
DATA_ARGS=()
LABEL_ARGS=(
  --label "vibed.managed=1"
  --label "vibed.role=ui"
)
if [[ "${VIBED_DATA_MODE:-volume}" == "bind" ]]; then
  mkdir -p "$VIBED_DATA_BIND_PATH"
  DATA_ABS="$(cd "$VIBED_DATA_BIND_PATH" && pwd)"
  DATA_ARGS=(-v "${DATA_ABS}:/data")
else
  DATA_ARGS=(-v "${VIBED_DATA_VOLUME}:/data")
  LABEL_ARGS+=(--label "vibed.data-volume=${VIBED_DATA_VOLUME}")
fi

if docker inspect "$UI_NAME" >/dev/null 2>&1; then
  echo "Removing existing container $UI_NAME ..."
  docker rm -f "$UI_NAME" >/dev/null
fi

ENV_ARGS=()
[[ -f .env ]] && ENV_ARGS+=(--env-file .env)

echo "Starting $UI_NAME on $NETWORK with SMTP :25 ..."
# shellcheck disable=SC2046
docker run -d \
  --name "$UI_NAME" \
  --restart unless-stopped \
  --network "$NETWORK" \
  $(memory_args "$UI_MEMORY") \
  "${LABEL_ARGS[@]}" \
  "${ENV_ARGS[@]}" \
  "${DATA_ARGS[@]}" \
  -e BIND_HOST=0.0.0.0 \
  -e HTTP_PORT=80 \
  -e SMTP_PORT=25 \
  -e DATA_DIR=/data \
  -p "25:25" \
  "$UI_IMAGE" >/dev/null

echo "Node $UI_NAME up (HTTP on $NETWORK:80, SMTP host :25)"
if [[ "${VIBED_DATA_MODE:-volume}" == "volume" ]]; then
  echo "DAL volume: $VIBED_DATA_VOLUME"
fi
