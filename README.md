# Redline Riot

A browser combat-motorcycle racer in the spirit of the early-90s classics: a pack of twelve riders,
eight kilometres of coast, redwood forest and mountain pass, traffic both ways, and fists.
All art and sound is generated in code.

## Run

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # headless simulation tests
pnpm typecheck
```

Controls: `W`/`S` throttle and brake, `A`/`D` steer, `J`/`L` punch left/right, `U`/`O` kick left/right,
`M` toggle sound (starts muted). Gamepad: RT/LT, left stick, X/B punch, LB/RB kick.

## Layout

- `packages/shared` — the deterministic simulation: track generator, bike physics, combat, AI, traffic.
  Fixed 60 Hz ticks, seeded RNG, no rendering. The same code will run on the multiplayer server.
  `scripts/stats.ts` runs an all-AI race and prints crash/speed stats for tuning.
- `apps/client` — three.js renderer, HUD, input and synthesised audio. Reads sim state each tick and
  interpolates between ticks for smooth motion.

Everything in the sim lives in track space: `s` metres along the road and `d` metres right of the
centreline. World positions are derived from the track frame at `s`.
