import { resolve } from "node:path";
import { GameServer } from "./server.ts";

const port = Number(process.env.PORT ?? 8787);
const lagMs = Number(process.env.SIM_LAG_MS ?? 0);
const jitterMs = Number(process.env.SIM_JITTER_MS ?? 0);
const staticDir = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : undefined;

const server = new GameServer({ port, lagMs, jitterMs, staticDir });
const actual = await server.listen();
console.log(`Redline Riot server on :${actual}${lagMs || jitterMs ? ` (simulated lag ${lagMs}ms ±${jitterMs}ms)` : ""}`);
