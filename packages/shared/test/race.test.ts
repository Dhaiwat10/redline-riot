import { describe, expect, it } from "vitest";
import { Race, RIVALS, generateTrack, type RacerEntry } from "../src/index.ts";

const entries = (): RacerEntry[] => RIVALS.map((r) => ({ ...r, human: false }));

function run(seed: number, maxTicks = 60 * 60 * 6) {
  const race = new Race(seed, entries());
  const none = new Map();
  let crashes = 0;
  let hits = 0;
  for (let i = 0; i < maxTicks && race.riders.some((r) => !r.finished); i++) {
    for (const e of race.step(none)) {
      if (e.type === "crash") crashes++;
      if (e.type === "hit") hits++;
    }
  }
  return { race, crashes, hits };
}

describe("track", () => {
  it("is long, and never folds back over itself", () => {
    const t = generateTrack(1);
    expect(t.length).toBeGreaterThan(7000);
    // Any two samples far apart along the road must be far apart in the world too.
    for (let i = 0; i < t.count; i += 25) {
      for (let j = i + 150; j < t.count; j += 25) {
        const d = Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]);
        expect(d).toBeGreaterThan(60);
      }
    }
  });

  it("projects world points back to track space", () => {
    const t = generateTrack(2);
    const f = t.frame(3000, { x: 0, y: 0, z: 0, fx: 0, fz: 0, rx: 0, rz: 0, heading: 0, curve: 0, slope: 0 });
    const p = t.project(f.x + f.rx * 5, f.z + f.rz * 5, { s: 0, d: 0, dist: 0 });
    expect(p.s).toBeCloseTo(3000, 0);
    expect(p.d).toBeCloseTo(5, 0);
  });
});

describe("race", () => {
  it("AI pack finishes in a sensible time, with some fighting and crashing", () => {
    const { race, crashes, hits } = run(7);
    const times = race.riders.map((r) => (r.finishTick > 0 ? r.finishTick / 60 : Infinity));
    console.log("finish times (s):", times.map((t) => t.toFixed(1)).join(" "), "crashes", crashes, "hits", hits);
    expect(race.riders.every((r) => r.finished)).toBe(true);
    expect(Math.min(...times)).toBeGreaterThan(120);
    expect(Math.max(...times)).toBeLessThan(320);
    expect(hits).toBeGreaterThan(5);
  });

  it("is deterministic", () => {
    const a = run(11, 60 * 40).race;
    const b = run(11, 60 * 40).race;
    expect(a.riders.map((r) => [r.s, r.d, r.health])).toEqual(b.riders.map((r) => [r.s, r.d, r.health]));
  });
});
