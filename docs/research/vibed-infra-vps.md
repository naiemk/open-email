# How vibed-infra 0.6 sits on an existing VPS

Ticket: [#43](https://github.com/naiemk/open-email/issues/43).
Branch: `research/vibed-infra-vps`.

**Question.** How does vibed-infra **0.6** host-gateway install onto a VPS that may already have nginx, and how do we map **node** (HTTPS UI + SMTP `:25`), **relayer**, and **DAL** onto `api` / `ui` / `nodes` / `gateway` profiles without a second 80/443 bind? Facts for the testnet deploy on the existing OVH box ([Working testnet node product](https://github.com/naiemk/open-email/issues/41)), not the product pick of hostnames or image layout.

Terms follow `CONTEXT.md`: **node** (SMTP + that **node**'s web app), **relayer**, **DAL**, **registry**. Gateway here is vibed-infra host nginx, not a fifth open-email product. npm **`vibed-infra@0.6.0`** was published 2026-08-30 (`time["0.6.0"]` = `2026-08-30T12:58:33.984Z`); git tag `v0.6.0` is `74cc9c70b4fbc0c3d1118fa54c6d3bafdc748dd1`. `npm pack vibed-infra@0.6.0` matches that tag for `README.md`, `install.sh`, `lib/host_gateway.sh`, `schema/packageconfig.md`, and `templates/host-gateway/`.

This note is research only. It does not add `templates/` or `dist/` to this repo and does not pick hostnames (`crypted.email` vs a relayer subdomain) or whether SMTP shares a container with the **node** UI.

---

## Answer in one page

vibed-infra 0.6's "existing nginx" is **its own Docker nginx**, once per machine, at `$GATEWAY_HOME` (default `~/services/gateway`). It is not a snippet for a pre-installed systemd/apt nginx. `install-gateway.sh` (profile `gateway`) bootstraps that host tree if the marker `.vibed-host-gateway` is missing; if the marker is present it prints `host gateway already present` and leaves host `nginx.conf` / `start-gateway.sh` alone. Either way it writes `$GATEWAY_HOME/apps/{product-name}/sites.conf` and the operator's `./start-gateway.sh` reloads the **one** container `vps-gateway`. Further products only add another `apps/{other}/sites.conf` and reload — no second 80/443 bind.

That container is the 80/443 binder: `docker run … -p "${HTTP_PORT}:80" -p "${HTTPS_PORT}:443"` with defaults `HTTP_PORT=80` `HTTPS_PORT=443`. Host nginx.conf is an `http { }` block that `include`s `conf.d/*.conf` and `apps/*/sites.conf`. There is no `mail` or `stream` block and no SMTP in any profile. The system-gateway skill: only the host binds 80/443; **do not run a second standalone nginx on 80/443**. A VPS that already has host nginx (or anything else) on those ports collides with `vps-gateway` unless that other listener is stopped, or `HTTP_PORT`/`HTTPS_PORT` are remapped (which is a second nginx, not a join). Certbot `--standalone` also needs port 80 free.

Four wget profiles per product. `api` / `ui` / `nodes` join Docker network `vps-edge` (default `network.edge`) and do **not** bind 80/443. `gateway` is host-extension nginx.

| Profile | Role in 0.6 | Host ports | What it is |
| --- | --- | --- | --- |
| `api` | `backend` | `HOST_PORT:8080` (default 8080) | One HTTP API container `{name}-api` |
| `ui` | `ui` | none | One HTTP UI container `{name}-ui`; nginx must proxy to `{name}-ui:80` |
| `nodes` | `workers` | none | Compose worker `{name}-worker` on `vps-edge`; talks to API via `API_URL` |
| `gateway` | `gateway`, `mode: host-extension` | 80/443 on `vps-gateway` only | Host nginx + `apps/{name}/sites.conf` |

Generated `sites.conf` is HTTPS `server { listen 443 ssl; }` per `gateway.sites[]` host: `location /api/` (plus optional health/create) → `{backend}:{backendPort}`; `location /` → `{ui}:{uiPort}`. Defaults: backend `{name}-api:8080`, ui `{name}-ui:80`. HTTP/80 on the host is ACME + `/_vibed/hooks/` + 301 to HTTPS.

Map onto open-email runtimes (facts, not a pick):

1. **gateway** — vibed-infra host nginx. One 80/443 for every public HTTPS name. Not a **node** / **relayer** / **DAL**.
2. **ui** — the **node** HTTPS UI. Today's tracer serves `/`, `/ui.js`, `/index/`, `/blobs/`, `/bootstrap/` from **one** HTTP server; those non-`/api/` paths match nginx `location /`, so they reach the **ui** upstream, not `api`.
3. **api** — the `/api/` upstream. Today's **relayer** (`/register`, `/opt-in`, `/nodes`, …) and **node** JSON (`/index/`, `/blobs/`, `/bootstrap/`) are **not** under `/api/`, so they do not automatically land on this profile.
4. **nodes** — internal workers, no public bind. A **DAL** pin/index process that only talks on `vps-edge` fits. A public blob HTTP gateway does not (that is another `sites[]` host or a second product's `apps/{name}/sites.conf`).
5. **SMTP `:25`** — not a vibed-infra profile. Stay outside nginx (extra `docker -p 25:25` on the **node** container, or a host SMTP process). Port 25 is not a second 80/443.

One product generates **one** api image, **one** ui image, **one** worker. A second public HTTP process (**relayer**, or a public **DAL** gateway) is a second product's `install-gateway.sh` (another `apps/{name}/sites.conf`, same `vps-gateway`) or a second `gateway.sites[]` host pointing at a container 0.6 does not start for you. `client_max_body_size` is **64k** on the host nginx.

---

## 1. What 0.6.0 ships

Published name **`vibed-infra`**, version **0.6.0**, latest dist-tag ([npm](https://www.npmjs.com/package/vibed-infra/v/0.6.0)). README:

> Product-agnostic VPS packager: **`package.sh`** builds committed **`dist/`** for wget install. One **host gateway** serves many apps…

Maintainer: `vibed-infra-config.yml` (name, templates, `network.edge` default `vps-edge`, `gateway.sites[]`, auto-update) plus `api-config.yaml` / `ui-config.yaml` / `nodes-config.yaml` (images + opaque config). `./package.sh` → commit `dist/`.

Operator:

```bash
wget -qO- .../dist/install-api.sh | bash
wget -qO- .../dist/install-ui.sh | bash
wget -qO- .../dist/install-nodes.sh | bash
wget -qO- .../dist/install-gateway.sh | bash   # bootstraps ~/services/gateway once + apps/{name}/
```

| Profile | Role (README) |
| --- | --- |
| `api` / `ui` / `nodes` | Join shared `vps-edge` |
| `gateway` | Host nginx + this app's `sites.conf` under `apps/` |

> Multi-app: further products' `install-gateway.sh` only add `apps/{other}/sites.conf` and reload — no second 80/443 bind.

Machine services, installed once: `~/services/gateway` (`GATEWAY_HOME`), `~/services/vibed-infra/update-agent`, `~/services/vibed-infra/persist-logs`. Env: `GATEWAY_HOME` default `~/services/gateway`; `VIBED_HOME` default `~/services/vibed-infra`.

`package.json` `"version": "0.6.0"`; `"files"` include `install.sh`, `package.sh`, `lib`, `templates`, `schema`, `skills`. Tag `v0.6.0` message: `chore: release vibed-infra v0.6.0`.

---

## 2. Schema: four files, four profiles, host-extension gateway

[`schema/packageconfig.md`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/schema/packageconfig.md): product repos ship **templates only**; `package.sh` generates committed `dist/`. Example `templates/vibed-infra-config.yml` has `network.edge: vps-edge`, `autoUpdate` per profile, and

```yaml
gateway:
  nginxImage: nginx:alpine
  sites:
    - host: app.example.com
      aliases: [www.app.example.com]
      healthPath: /api/health
      createPath: /api/items
      tlsCertDir: /etc/letsencrypt/live/app.example.com
```

Defaults: containers `{name}-api` / `{name}-ui` / `{name}-worker`; host gateway container **`vps-gateway`**.

`dist/` includes `install-*.sh`, `start-*.sh` / `update-*.sh`, `.env.*.example`, `packageconfig.yaml`, `DNS-SKILL.md`.

> Gateway install writes `$GATEWAY_HOME/apps/{name}/sites.conf` (host-extension mode).

`INFRA_PROFILE` is `api`, `ui`, `nodes`, or `gateway`.

[`lib/product_config.py`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/lib/product_config.py) `compile_packageconfig`:

- `network = (infra.get("network") or {}).get("edge") or "vps-edge"`.
- Per site: `backend` defaults to `{name}-api`, `backendPort` to `api.port` or **8080**, `ui` to `{name}-ui`, `uiPort` to `ui.port` or **80**. `site.get("backend")` / `site.get("ui")` override container names.
- Profiles: `api.role = backend`; `ui.role = ui`; `nodes.role = workers` with compose `docker-compose.workers.yml`; `gateway.role = gateway`, **`mode: host-extension`**, `sites: sites`.
- `_meta.gatewayContainer = "vps-gateway"`.

[`lib/package.py`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/lib/package.py) writes four `install-{profile}.sh` wrappers that set `INFRA_PROFILE` and exec packager `install.sh` from `https://raw.githubusercontent.com/naiemk/vibed-infra/main` (override with `PACKAGER_RAW`). `.env.gateway.example` includes `GATEWAY_HOME=~/services/gateway`, `GATEWAY_NAME={meta['gatewayContainer']}` (`vps-gateway`), `HTTP_PORT=80`, `HTTPS_PORT=443`. `.env.api.example` includes `HOST_PORT={meta['apiPort']}`. `.env.ui.example` has **no** host port. `.env.nodes.example` has `API_URL=http://{apiContainer}:{apiPort}` and no host port. Generated workers compose uses `networks.edge.external: true` (API must already be on the network).

The infra-packager skill: gateway is nginx-only and does not start the UI; never overwrite existing `.env` on re-install; container names in `gateway.sites[]` must match running API/UI names on `network.edge`.

---

## 3. `install-gateway.sh` and existing `GATEWAY_HOME`

`install-*.sh` in `dist/` are thin wrappers ([`lib/package.py` `_install_wrapper`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/lib/package.py)). Real work is packager [`install.sh`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/install.sh) with `--profile gateway`.

`GATEWAY_HOME` resolution ([`lib/host_gateway.sh` `vibed_gateway_home`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/lib/host_gateway.sh)): env `GATEWAY_HOME`, else `${HOME}/services/gateway`, else `/var/lib/vibed/gateway`. Ready iff `${home}/.vibed-host-gateway` exists (`vibed_host_gateway_ready`).

### Phase 1 — bootstrap host once

`vibed_bootstrap_host_gateway`:

1. `mkdir -p "$home/gateway/conf.d" "$home/apps" "$home/certs" "$home/certbot-www"`.
2. If `.vibed-host-gateway` exists: echo `host gateway already present: $home` and **`return 0`** — does not refresh `nginx.conf`, `00-default.conf`, or host start scripts.
3. Else fetch from packager `templates/host-gateway/`: `gateway/nginx.conf`, `gateway/conf.d/00-default.conf`, `.env.example`, `start-gateway.sh`, `reload-gateway.sh`, `update-gateway.sh`. Copy `.env.example` → `.env` only if `.env` is missing. Write marker `1` into `.vibed-host-gateway`.

Existing `GATEWAY_HOME` with the marker is therefore idempotent for the **host skeleton**. A second product does not get a second nginx tree.

### Phase 2 — this product's `apps/{name}/sites.conf`

`install.sh` (role `gateway`):

1. `python3 generate.py … --profile gateway --mode app` → `DEST/gateway/sites.conf`.
2. `vibed_install_app_sites "$PRODUCT_NAME" …` copies that file to `$GATEWAY_HOME/apps/${app_name}/sites.conf` (and `meta.json`). `cp -f` — **overwrites** that product's sites on re-install; other `apps/*` are untouched.
3. Replaces `DEST/start-gateway.sh` / `update-gateway.sh` with thin wrappers that `export GATEWAY_HOME` and call `vibed_reload_or_start_gateway` (update also regenerates this app's `sites.conf`). The standalone [`templates/generic/start-gateway.sh`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/generic/start-gateway.sh) still lives in **committed `dist/`**; after `install-gateway.sh` the install dir's start script is the host wrapper.
4. Does not start Docker during install. Operator: `cd $DEST && ./start-gateway.sh`.
5. If `.env` already exists: `exists: $DEST/.env` (no overwrite). If host gateway is ready, product `.env` `DOCKER_NETWORK` is rewritten to the host's `DOCKER_NETWORK` (`joined host edge network: …`).
6. TLS: prefer host certs; if missing, try product `gen-dev-certs.sh` into `$GATEWAY_HOME/certs`; `infra_tls_offer_interactive` may suggest certbot (port 80 must be free for `--standalone`).

`vibed_reload_or_start_gateway`: if container `GATEWAY_NAME` (default `vps-gateway`) exists, run `reload-gateway.sh`; else `start-gateway.sh`. [`reload-gateway.sh`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/host-gateway/reload-gateway.sh): `PULL=0 exec ./start-gateway.sh`. Comment: **Same ports; no second bind.** Recreate, not a second listener.

Dry-run in [`scripts/validate-package.sh`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/scripts/validate-package.sh): after `install-gateway.sh`, asserts `$GATEWAY_HOME/.vibed-host-gateway` and `$GATEWAY_HOME/apps/hello-vps/sites.conf` containing `hello.example.com`. Example operator README: host gateway `~/services/gateway` + `apps/hello-vps/sites.conf`; `gateway` "Bootstraps shared host once; later apps only add `apps/{name}/`".

---

## 4. The host nginx process (and a VPS that already has nginx)

Layout from [`skills/system-gateway/SKILL.md`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/skills/system-gateway/SKILL.md):

```
~/services/gateway/                 # GATEWAY_HOME — once per machine
  .vibed-host-gateway               # marker
  start-gateway.sh / reload-gateway.sh
  gateway/nginx.conf                # includes conf.d + apps/*/sites.conf
  gateway/conf.d/00-default.conf    # ACME + HTTP→HTTPS + /_vibed/hooks/
  apps/
    hello-vps/sites.conf
    other-app/sites.conf
```

- Shared Docker network **`vps-edge`**.
- **Only the host binds 80/443.** Product `install-gateway.sh` bootstraps host if missing, then installs/updates that product's `apps/{name}/sites.conf` and reloads.
- Pitfall: **Do not run a second standalone nginx on 80/443.**
- Override: `GATEWAY_HOME=/path/to/gateway`.
- TLS: lab `gen-dev-certs.sh` into `$GATEWAY_HOME/certs`; production certbot; set `TLS_FULLCHAIN` / `TLS_PRIVKEY` on the **host** `.env`, then `./reload-gateway.sh`.

[`templates/host-gateway/start-gateway.sh`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/host-gateway/start-gateway.sh): requires TLS files; `docker network create "$NETWORK"` (`vps-edge`); if `GATEWAY_NAME` exists, `docker rm -f`; `docker run -d --name vps-gateway --network vps-edge --add-host=host.docker.internal:host-gateway -p "${HTTP_PORT}:80" -p "${HTTPS_PORT}:443"`. Copies host `nginx.conf`, `conf.d`, **all** `apps/*/sites.conf`, and certs into the container. Recreate is how reload picks up a new app.

[`templates/host-gateway/gateway/nginx.conf`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/host-gateway/gateway/nginx.conf): `http { … include /etc/nginx/conf.d/*.conf; include /etc/nginx/apps/*/sites.conf; }` plus `client_max_body_size 64k` and rate-limit zones `api_create` / `api_public`. No `stream`, no `mail`.

[`templates/host-gateway/gateway/conf.d/00-default.conf`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/host-gateway/gateway/conf.d/00-default.conf): `listen 80 default_server`; ACME webroot; `/_vibed/hooks/` → `host.docker.internal:19200`; else `return 301 https://$host$request_uri`.

[`templates/host-gateway/.env.example`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/host-gateway/.env.example): `DOCKER_NETWORK=vps-edge`, `GATEWAY_NAME=vps-gateway`, `HTTP_PORT=80`, `HTTPS_PORT=443`.

There is **no** code that detects `nginx` on the host, writes `/etc/nginx/sites-enabled`, or reverse-proxies from systemd nginx into `vps-gateway`. "Join existing nginx" in 0.6 means join an **already-bootstrapped vibed-infra host gateway**. An OVH box whose apt/systemd nginx already owns 80/443 will fail `docker run -p 80:80` (or starve ACME) unless that nginx is stopped so `vps-gateway` is the listener. Remapping `HTTP_PORT`/`HTTPS_PORT` avoids the bind conflict but is a second HTTP server, which the skill forbids on 80/443. [`lib/tls.sh`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/lib/tls.sh): "TLS certificates not found. Issue with certbot (port 80 must be free)" for `--standalone`; webroot is the other path once gateway HTTP is up.

`api` `start-api.sh` **does** publish `-p "${HOST_PORT}:8080"` (default 8080). That is not 80/443. Gateway talks to the API by **container name on `vps-edge`**, so the host publish is not required for the nginx path (the example e2e UI test curls `http://${API_NAME}:8080` on the Docker network). `ui` and `nodes` publish no host ports.

---

## 5. What `sites.conf` actually proxies (HTTP only)

[`lib/generate.py`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/lib/generate.py) `--mode app` (install uses this): per site, one `server { listen 443 ssl; http2 on; server_name … }` with:

- `location = {healthPath}` → backend (default `/api/health`)
- optional `location = {createPath}` → backend, `limit_req zone=api_create`
- `location /api/` → backend, `limit_req zone=api_public`
- `location /` → ui

Upstreams are Docker DNS: `set $…_upstream {backend}:{backendPort}` and `{ui}:{uiPort}`. Certificates default to `/etc/nginx/certs/fullchain.pem` inside the container (host start script copies host `TLS_FULLCHAIN` / `TLS_PRIVKEY` there).

Hello-vps compiled packageconfig (example `dist/packageconfig.yaml`): one site `hello.example.com`, `backend: hello-vps-api`, `backendPort: 8080`, `ui: hello-vps-ui`, `uiPort: 80`, `healthPath: /api/health`, `createPath: /api/notes`. Example e2e (`examples/vps-hello/test/run.sh` profile `ui`): after start, `https://vps-gateway/api/health` with `Host: hello.example.com` hits the API; `https://vps-gateway/` returns UI HTML; plain HTTP returns 301/308.

Nothing in generate.py, host nginx.conf, or the four profiles mentions SMTP, port 25, or TCP stream proxy. Grep of 0.6.0 `templates/` and `skills/` has no `smtp` / `:25`.

DNS skill writes **A** records for each `gateway.sites[]` host and alias to the VPS IPv4 — HTTPS names only, not MX ([`skills/dns-configure/SKILL.md`](https://github.com/naiemk/vibed-infra/blob/v0.6.0/skills/dns-configure/SKILL.md); MX for `crypted.email` is a prior decision on the first-receive map).

---

## 6. Mapping **node**, **relayer**, **DAL** onto the four profiles

Open-email runtimes (this repo + map notes), vs one vibed-infra product:

**Node** ([`node/src/node.ts`](https://github.com/naiemk/open-email/blob/main/node/src/node.ts), ADR 0001): one process, SMTP (`SMTPServer`, tracer listens `127.0.0.1` with `smtpPort`) **and** HTTP (`/_`, `/ui.js`, `/index/…`, `/blobs/…`, `/bootstrap/…`). HTTPS UI is this HTTP behind TLS. SMTP is not HTTP.

**Relayer** ([`relayer/src/server.ts`](https://github.com/naiemk/open-email/blob/main/relayer/src/server.ts)): HTTP only. Paths `/register-challenge`, `/register`, `/opt-in`, `/opt-out`, `/nodes`, `/names/…`, `/opted-in/…` — **not** under `/api/`.

**DAL** ([`dal/src/storage.ts`](https://github.com/naiemk/open-email/blob/main/dal/src/storage.ts), [`dal/src/indexLog.ts`](https://github.com/naiemk/open-email/blob/main/dal/src/indexLog.ts)): tracer is an in-process blob store + index used by the **node**. The map still deploys **DAL** as a runtime; [Which DAL holds the first public mailbox?](https://github.com/naiemk/open-email/issues/23) already recorded pin-on-node plus a protocol index and HTTP blob reads. A public HTTPS blob/index gateway is HTTP; a pin/index daemon that only the **node** calls can stay off 80/443.

**Registry** is on-chain (Sepolia), not a vibed-infra profile.

What 0.6 will actually start for **one** product named e.g. `open-email`:

| 0.6 artifact | Default |
| --- | --- |
| containers | `open-email-api`, `open-email-ui`, `open-email-worker`, plus machine `vps-gateway` |
| `sites.conf` | `/api/` → `open-email-api:8080`; `/` → `open-email-ui:80` |
| host binds from templates | `vps-gateway` 80/443; api also `HOST_PORT:8080`; ui/nodes none |

Fit that does not invent a fifth 80/443 nginx:

| Open-email process | 0.6 profile | Why |
| --- | --- | --- |
| **node** HTTPS UI | `ui` | Catch-all `location /`. Tracer `/index/` `/blobs/` `/bootstrap/` also match `/`, so they hit **ui**, not `api`, unless paths move under `/api/` or get their own `location`. |
| **node** JSON under `/api/` (if added) | `api` | That is the only generated API prefix. |
| **relayer** HTTP | not automatic | Paths are not `/api/`. Options 0.6 actually supports: (a) put relayer behind `/api/` on the same site; (b) second `gateway.sites[]` host whose `backend` **and** `ui` both name the relayer container (`/register` matches `location /`); (c) **second product** `install-gateway.sh` → `apps/relayer/sites.conf` on the same `vps-gateway`. (b) and (c) still need a start script 0.6 does not generate for a fourth container — (c) is the documented multi-app path (`install-api.sh` of that product). |
| **DAL** internal pin/index | `nodes` | Workers, no host port, `vps-edge` only. Compose has no `ports:`. |
| **DAL** public HTTPS | another site or product | Same as relayer: extra `apps/{name}/sites.conf`, not `nodes`. |
| **node** SMTP `:25` | **none** | Host nginx is `http {}` only. Publish `:25` on the **node** container (custom `docker run` / compose, not `start-ui.sh` / `start-api.sh` as shipped) or a host smtpd. Not a second 80/443. |
| Host TLS / ACME / many apps | `gateway` | One `vps-gateway`. |

`site.backend` / `site.ui` overrides let one `vibed-infra-config.yml` point two hostnames at two container names, but `package.py` still only emits **three** app images and three start scripts. Extra HTTP processes are extra products (extra `install-*.sh`) or extra start scripts (`profiles.*.extras` in install.sh copies extra files from `PRODUCT_RAW`; compiled gateway profile does not set `extras`).

**node** as a single process (SMTP + HTTP) does not match one 0.6 start script: `start-ui.sh` has no `-p 25:25`; `start-api.sh` has only `-p HOST_PORT:8080`; `start-nodes.sh` has no ports. SMTP on the same container as the UI needs a product-owned start/compose, not the generic templates.

Body size: host nginx `client_max_body_size 64k`. Mail blobs through this proxy inherit that limit; SMTP on `:25` does not.

---

## 7. Facts for a later grill (not a pick)

- 0.6 host gateway **is** Docker nginx on 80/443. It does not join apt nginx. On a VPS that already listens there, stop that listener or do not use 0.6's host bind.
- Second 80/443 bind is avoided by `apps/{name}/sites.conf` + reload of `vps-gateway`. SMTP `:25` and optional `HOST_PORT` 8080 are other ports.
- One product = one `/api/` backend + one `/` UI + one worker. **node** UI, **relayer**, and a public **DAL** HTTP gateway are three HTTP personalities; the tracer **node** also speaks SMTP. Extra HTTPS names use more `sites[]` or more products on the same host gateway.
- Generated locations are `/api/` vs `/`. Today's **relayer** and **node** JSON paths are not `/api/`.
- SMTP stays outside nginx unless someone adds a non-0.6 `stream`/`mail` config.
- `client_max_body_size 64k` is a real constraint if blobs traverse this nginx.
- This note does not pick `crypted.email` vs a relayer host, whether **node** HTTP splits from SMTP, or pinning vendor vs local Kubo (still fog on the map).

---

## Sources

- [npm vibed-infra 0.6.0](https://www.npmjs.com/package/vibed-infra/v/0.6.0)
- [vibed-infra README (v0.6.0)](https://github.com/naiemk/vibed-infra/blob/v0.6.0/README.md)
- [schema/packageconfig.md](https://github.com/naiemk/vibed-infra/blob/v0.6.0/schema/packageconfig.md)
- [skills/system-gateway/SKILL.md](https://github.com/naiemk/vibed-infra/blob/v0.6.0/skills/system-gateway/SKILL.md)
- [skills/infra-packager/SKILL.md](https://github.com/naiemk/vibed-infra/blob/v0.6.0/skills/infra-packager/SKILL.md)
- [skills/dns-configure/SKILL.md](https://github.com/naiemk/vibed-infra/blob/v0.6.0/skills/dns-configure/SKILL.md)
- [install.sh](https://github.com/naiemk/vibed-infra/blob/v0.6.0/install.sh)
- [lib/host_gateway.sh](https://github.com/naiemk/vibed-infra/blob/v0.6.0/lib/host_gateway.sh)
- [lib/package.py](https://github.com/naiemk/vibed-infra/blob/v0.6.0/lib/package.py)
- [lib/product_config.py](https://github.com/naiemk/vibed-infra/blob/v0.6.0/lib/product_config.py)
- [lib/generate.py](https://github.com/naiemk/vibed-infra/blob/v0.6.0/lib/generate.py)
- [lib/tls.sh](https://github.com/naiemk/vibed-infra/blob/v0.6.0/lib/tls.sh)
- [templates/host-gateway/start-gateway.sh](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/host-gateway/start-gateway.sh)
- [templates/host-gateway/reload-gateway.sh](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/host-gateway/reload-gateway.sh)
- [templates/host-gateway/update-gateway.sh](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/host-gateway/update-gateway.sh)
- [templates/host-gateway/gateway/nginx.conf](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/host-gateway/gateway/nginx.conf)
- [templates/host-gateway/gateway/conf.d/00-default.conf](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/host-gateway/gateway/conf.d/00-default.conf)
- [templates/host-gateway/.env.example](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/host-gateway/.env.example)
- [templates/generic/start-api.sh](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/generic/start-api.sh)
- [templates/generic/start-ui.sh](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/generic/start-ui.sh)
- [templates/generic/start-nodes.sh](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/generic/start-nodes.sh)
- [templates/generic/start-gateway.sh](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/generic/start-gateway.sh)
- [templates/docker-compose.workers.yml](https://github.com/naiemk/vibed-infra/blob/v0.6.0/templates/docker-compose.workers.yml)
- [package.json](https://github.com/naiemk/vibed-infra/blob/v0.6.0/package.json)
- [scripts/validate-package.sh](https://github.com/naiemk/vibed-infra/blob/v0.6.0/scripts/validate-package.sh)
- [examples/vps-hello/README.md](https://github.com/naiemk/vibed-infra/blob/v0.6.0/examples/vps-hello/README.md)
- [examples/vps-hello/templates/vibed-infra-config.yml](https://github.com/naiemk/vibed-infra/blob/v0.6.0/examples/vps-hello/templates/vibed-infra-config.yml)
- [examples/vps-hello/dist/packageconfig.yaml](https://github.com/naiemk/vibed-infra/blob/v0.6.0/examples/vps-hello/dist/packageconfig.yaml)
- [examples/vps-hello/test/run.sh](https://github.com/naiemk/vibed-infra/blob/v0.6.0/examples/vps-hello/test/run.sh)
- [node/src/node.ts](https://github.com/naiemk/open-email/blob/main/node/src/node.ts)
- [relayer/src/server.ts](https://github.com/naiemk/open-email/blob/main/relayer/src/server.ts)
- [dal/src/storage.ts](https://github.com/naiemk/open-email/blob/main/dal/src/storage.ts)
- [docs/adr/0001-node-is-a-provider.md](https://github.com/naiemk/open-email/blob/main/docs/adr/0001-node-is-a-provider.md)
- [CONTEXT.md](https://github.com/naiemk/open-email/blob/main/CONTEXT.md)
