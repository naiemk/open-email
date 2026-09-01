# Node web UI

React + Vite app served from `node/web/dist/` in production.

## Local dev (mock passkey + demo mail)

```bash
npm run dev:ui
```

Open [http://localhost:5173/?mock=1](http://localhost:5173/?mock=1)

- **Demo sign in** — pre-registered `demouser@testnet.crypted.email` with seeded inbox
- **Sign up** — full flow with fake checkout (Mark paid on invoice page)
- No real WebAuthn or relayer required

Backend runs on `:8787` (anvil + embedded relayer). Vite proxies API calls.

## Production build

```bash
npm run build:ui
```
