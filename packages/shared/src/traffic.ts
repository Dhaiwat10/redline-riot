import { ROAD_HALF_WIDTH } from "./constants.ts";
import { Rng } from "./rng.ts";
import type { Track } from "./track.ts";

export type CarKind = "sedan" | "pickup" | "van";

export interface Car {
  id: number;
  kind: CarKind;
  colour: number;
  s: number;
  d: number;
  speed: number; // signed: negative = oncoming
  length: number;
  width: number;
}

const CAR_COLOURS = [0xd8d4c8, 0x2f4f6f, 0x8a1c1c, 0x3f5f3a, 0x1e1e22, 0xc9a227, 0x6d7a86, 0x7b4b2a];

export function generateTraffic(track: Track): Car[] {
  const rng = new Rng(track.seed * 17 + 3);
  const cars: Car[] = [];
  const lane = ROAD_HALF_WIDTH / 2;
  let id = 0;
  for (const dir of [1, -1]) {
    for (let s = track.startLine + (dir > 0 ? 450 : 300); s < track.length - 100; s += rng.range(170, 320)) {
      const kind: CarKind = rng.pick(["sedan", "sedan", "pickup", "van"] as const);
      cars.push({
        id: id++,
        kind,
        colour: rng.pick(CAR_COLOURS),
        s,
        d: dir > 0 ? lane + rng.range(-0.4, 0.4) : -lane + rng.range(-0.4, 0.4),
        speed: dir * rng.range(20, 27),
        length: kind === "van" ? 5.2 : kind === "pickup" ? 5.4 : 4.6,
        width: kind === "van" ? 2.0 : 1.9,
      });
    }
  }
  return cars;
}

/** Moves cars along the road, wrapping them so the road stays populated. */
export function stepTraffic(cars: Car[], track: Track, dt: number): void {
  const span = track.length - track.startLine - 200;
  for (const c of cars) {
    c.s += c.speed * dt;
    if (c.s > track.length - 50) c.s -= span;
    else if (c.s < track.startLine + 150) c.s += span;
  }
}
