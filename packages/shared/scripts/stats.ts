import { Race, RIVALS } from "../src/index.ts";
const race = new Race(Number(process.argv[2] ?? 7), RIVALS.map((r) => ({ ...r, human: false })));
const causes: Record<string, number> = {};
let speedSum = 0, n = 0, offroad = 0;
for (let i = 0; i < 60 * 60 * 6 && race.riders.some((r) => !r.finished); i++) {
  for (const e of race.step(new Map())) if (e.type === "crash") {
    const r = race.riders[e.rider];
    causes[e.cause] = (causes[e.cause] ?? 0) + 1;
    if (false) console.log(i, r.name, e.cause, "s", r.s.toFixed(0), "d", r.d.toFixed(1));
  }
  for (const r of race.riders) if (r.mode === "riding" && race.phase === "racing") { speedSum += r.speed; n++; if (Math.abs(r.d) > 9.5) offroad++; }
}
console.log(causes, "avg speed", (speedSum / n).toFixed(1), "offroad frac", (offroad / n).toFixed(3));
