# Redline Riot

A Road Rash-inspired combat motorcycle racer for the browser. Twelve riders, an 8 km
point-to-point road, traffic both ways, and fists. Online multiplayer, plays on desktop and phones.
All code, art and sound are original; nothing is taken from the original games.

Play: https://redline-riot.fly.dev

## Controls

| | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Throttle / brake | `W` / `S` | RT / LT | automatic / brake button |
| Steer | `A` / `D` | left stick | drag sideways on the left half |
| Punch left / right | `J` / `L` | X / B | buttons |
| Kick left / right | `U` / `O` | LB / RB | buttons |
| Sound on/off | `M` | | |

## Development

Requires Node 22 and pnpm.

```bash
pnpm install
pnpm dev        # client on :5173, game server on :8787
pnpm dev:lag    # same, with 150 ms ±30 ms simulated latency
pnpm test
pnpm typecheck
```

To race yourself locally, create a private race and open its invite link (`/r/<code>`) in a
second window.

## Layout

- `packages/shared` – deterministic simulation: track generation, bike physics, combat, AI,
  traffic, and the network protocol. Fixed 60 Hz ticks, no rendering.
- `apps/server` – authoritative Node WebSocket server. Private rooms by link and public quick-play
  lobbies, with AI filling empty grid slots. Serves the built client in production.
- `apps/client` – three.js renderer, HUD, menus, input and synthesised audio.

Positions in the sim are in track space: `s` metres along the road, `d` metres right of centre.

## Netcode

- Clients send inputs only; the server runs the race and sends snapshots at 30 Hz.
- Your own bike is predicted locally and reconciled by replaying unacknowledged inputs.
- Other riders are interpolated ~100 ms in the past.
- Hits are checked against what the attacker saw, up to 150 ms back.
- Traffic is a function of time, so it is never sent.

## Deploy

Runs on Fly.io as a single machine (races live in memory), which sleeps when idle.

```bash
pnpm deploy     # fly deploy --ha=false
```

## Licence

MIT. See [LICENSE](LICENSE).

---

Not affiliated with or endorsed by Electronic Arts. Road Rash is a trademark of Electronic Arts Inc.
