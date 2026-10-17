# Redline Riot

A browser combat-motorcycle racer in the spirit of the early-90s classics: a pack of twelve riders,
eight kilometres of coast, redwood forest and mountain pass, traffic both ways, and fists.
All art and sound is generated in code.

## Run

```bash
pnpm install
pnpm dev        # client on http://localhost:5173 + game server on :8787
pnpm dev:lag    # same, with 150 ms ±30 ms simulated latency to test netcode
pnpm test       # simulation, protocol and server tests
pnpm typecheck
pnpm start      # production: builds the client and serves it from the game server
```

Open a second browser window to race yourself: create a private race in one, then open the
invite link (`/r/<code>`) in the other.

Controls: `W`/`S` throttle and brake, `A`/`D` steer, `J`/`L` punch left/right, `U`/`O` kick left/right,
`M` toggle sound (starts muted). Gamepad: RT/LT, left stick, X/B punch, LB/RB kick.

On phones and tablets (portrait or landscape): drag sideways anywhere on the left half to steer, throttle is
automatic, and the right side has brake, punch and kick buttons. Phones get a lighter graphics
tier, and render resolution adapts to hold the frame rate. To try it on your phone, run `pnpm dev`
and open the "Network" URL Vite prints, on the same Wi-Fi.

## Deploy

Live at https://redline-riot.fly.dev (Fly.io, London). Races live in server memory, so it runs on
a single machine that sleeps when idle and wakes on the next visit.

```bash
pnpm deploy     # fly deploy --ha=false
```

## Layout

- `packages/shared` — the deterministic simulation: track generator, bike physics, combat, AI, traffic.
  Fixed 60 Hz ticks, seeded RNG, no rendering. The same code will run on the multiplayer server.
  `scripts/stats.ts` runs an all-AI race and prints crash/speed stats for tuning.
- `apps/server` — authoritative Node + WebSocket server. Rooms (private by link, or public via quick
  play), runs each race at 60 Hz, sends 30 Hz snapshots, rewinds hit checks to what the attacker saw.
- `apps/client` — three.js renderer, HUD, input and synthesised audio. Reads sim state each tick and
  interpolates between ticks for smooth motion.

Everything in the sim lives in track space: `s` metres along the road and `d` metres right of the
centreline. World positions are derived from the track frame at `s`.

## Multiplayer netcode

- The server runs the real race; clients only send inputs (15-byte binary frames, 60/s).
- Your own bike is predicted locally and reconciled against server snapshots by replaying unacked
  inputs; any correction is smoothed visually.
- Other riders are interpolated about 100 ms in the past.
- Hits are judged against where the target was on the attacker's screen (capped at 150 ms).
- Traffic is a pure function of time, so it is never sent.
- Disconnected riders are taken over by the AI.
