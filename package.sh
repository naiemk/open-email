#!/usr/bin/env bash
# Proxy to vibed-infra 0.13 packager, then overlay this product's start scripts.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGER="$(node -e "console.log(require('path').dirname(require.resolve('vibed-infra/package.json')))")"
bash "$PACKAGER/package.sh" \
  --product "$ROOT" \
  --out "$ROOT/dist" \
  --raw-base "https://raw.githubusercontent.com/naiemk/open-email/main/dist" \
  --packager-raw "https://raw.githubusercontent.com/naiemk/vibed-infra/v0.13.0"

cp "$ROOT/deploy/start-api.sh" "$ROOT/dist/start-api.sh"
cp "$ROOT/deploy/start-ui.sh" "$ROOT/dist/start-ui.sh"
chmod +x "$ROOT/dist/start-api.sh" "$ROOT/dist/start-ui.sh"

{
  echo ""
  echo "# open-email **relayer** (api profile)"
  echo "EVM_PRIVATE_KEY="
  echo "L2_RPC_URL=https://base-sepolia-rpc.publicnode.com"
  echo "CHAIN_ID=84532"
  echo "REGISTRY="
  echo "BIND_HOST=0.0.0.0"
  echo "PORT=8080"
} >> "$ROOT/dist/.env.api.example"

{
  echo ""
  echo "# open-email **node** (ui profile): HTTP on vps-edge:80, SMTP host :25, DAL under /data"
  echo "DOMAIN=testnet.crypted.email"
  echo "BIND_HOST=0.0.0.0"
  echo "HTTP_PORT=80"
  echo "SMTP_PORT=25"
  echo "RELAYER_URL=http://open-email-api:8080"
  echo "NODE_SECRET="
  echo "DKIM_PRIVATE_KEY="
  echo "TURNSTILE_SECRET="
  echo "TURNSTILE_SITE_KEY="
  echo "DISABLE_TURNSTILE=1"
  echo "INVOICE_TO="
  echo "COMMERCE_API_URL=https://testnet.trustless-commerce.com"
  echo "PUBLIC_URL=https://testnet.crypted.email"
  echo "FAKE_CHECKOUT=0"
} >> "$ROOT/dist/.env.ui.example"
sed -i 's/^UI_MEMORY_LIMIT=32m/UI_MEMORY_LIMIT=512m/' "$ROOT/dist/.env.ui.example"
sed -i 's/client_max_body_size [^;]*;/client_max_body_size 25m;/' "$ROOT/dist/gateway/nginx.conf"
if ! grep -q 'command: \["sleep", "infinity"\]' "$ROOT/dist/docker-compose.workers.yml"; then
  sed -i '/extra_hosts:/i\    command: ["sleep", "infinity"]' "$ROOT/dist/docker-compose.workers.yml"
fi

python3 - "$ROOT/dist/docker-compose.workers.yml" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text()
if "command:" not in text:
    text = text.replace(
        "    extra_hosts:\n",
        "    command: [\"sleep\", \"infinity\"]\n    extra_hosts:\n",
    )
    p.write_text(text)
PY

cat >> "$ROOT/dist/README.md" <<'EOF'

## open-email notes

- **api** is the **relayer** (vps-edge only; not published on :8080).
- **ui** is the **node** (HTTPS via host gateway; SMTP `0.0.0.0:25`).
- Gateway `sites[]` send both `/` and `/api/` to `open-email-ui` so Turnstile/opt rate limits stay on the **node**.
- Gateway default `client_max_body_size` is **25m** (supports compose attachments). Reload nginx after updating `dist/gateway/nginx.conf`.
- OpenPGP WKD is served by the **node** at `/.well-known/openpgpkey/` (gateway must proxy that path to open-email-ui).
- Images: `ghcr.io/naiemk/open-email-api:main` and `ghcr.io/naiemk/open-email-ui:main`.
- Skip `install-nodes` only if you do not want the idle worker; SMTP and **DAL** live on the UI container.
EOF
