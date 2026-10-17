import { describe, expect, it } from "vitest";
import { Attack, INPUT_FRAME_BYTES, Race, RIVALS, decodeInput, decodeSnapshot, encodeInput, encodeSnapshot, riderNetState } from "../src/index.ts";

describe("protocol", () => {
  it("round-trips input frames", () => {
    const f = { seq: 123456, viewTick: 999, input: { throttle: 1, brake: 0, steer: -0.5, attack: Attack.Kick, attackSide: -1 as const } };
    const back = decodeInput(encodeInput(f));
    expect(back.seq).toBe(123456);
    expect(back.viewTick).toBe(999);
    expect(back.input.attack).toBe(Attack.Kick);
    expect(back.input.attackSide).toBe(-1);
    expect(back.input.steer).toBeCloseTo(-0.5, 1);
    // The server rejects any input frame that isn't exactly this size.
    expect(encodeInput(f).length).toBe(INPUT_FRAME_BYTES);
  });

  it("round-trips a mid-race snapshot within quantisation", () => {
    const race = new Race(5, RIVALS.map((r) => ({ ...r, human: false })));
    let events: ReturnType<Race["step"]> = [];
    const all: typeof events = [];
    for (let i = 0; i < 60 * 40; i++) {
      events = race.step(new Map());
      all.push(...events);
    }
    // Force one rider into a crash so the crash block is exercised.
    race.riders[3].mode = "crashing";
    race.riders[3].crash = { bodyS: 10, bodyD: 1, bodyH: 0.5, bodyVs: 3, bodyVd: 0, bodyVh: 1, bodySpin: 4, bodyRot: 1, bikeS: 9, bikeD: 2, bikeVs: 1, bikeVd: 0, bikeRot: 2, bikeSpin: 1, t: 5, rest: 0 };
    const snap = { tick: race.tick, phase: race.phase, countdown: race.countdown, ackSeq: 77, riders: race.riders.map(riderNetState), events: all.slice(0, 20) };
    const bytes = encodeSnapshot(snap);
    const back = decodeSnapshot(bytes);
    expect(bytes.length).toBeLessThan(700);
    expect(back.tick).toBe(race.tick);
    expect(back.ackSeq).toBe(77);
    expect(back.events).toEqual(snap.events.map((e) => (e.type === "bump" ? { ...e, strength: Math.round(e.strength * 100) / 100 } : e)));
    back.riders.forEach((r, i) => {
      const o = race.riders[i];
      expect(r.s).toBeCloseTo(o.s, 1);
      expect(r.d).toBeCloseTo(o.d, 1);
      expect(r.mode).toBe(o.mode);
      expect(r.place).toBe(o.place);
    });
    expect(back.riders[3].crash?.bikeS).toBeCloseTo(9);
  });
});
