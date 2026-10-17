import { ROAD_HALF_WIDTH, SHOULDER_WIDTH } from "./constants.ts";
import { Rng } from "./rng.ts";
import { newFrame, type Biome, type Track } from "./track.ts";

export type PropKind = "pine" | "redwood" | "cypress" | "rock" | "boulder" | "pole" | "chevron";

export interface Prop {
  kind: PropKind;
  s: number;
  d: number;
  /** Collision radius in metres (0 = decorative only). */
  radius: number;
  scale: number;
  rot: number;
}

/** Props further than this from the centreline never need collision checks. */
export const COLLIDE_MAX_D = 26;

const pickBiome = (w: Record<Biome, number>, r: number): Biome =>
  r < w.coast ? "coast" : r < w.coast + w.forest ? "forest" : "alpine";

/**
 * Roadside props near the road. These are shared by the simulation (as colliders) and
 * the renderer. Far-away decorative scenery is generated client side only.
 */
export function generateProps(track: Track): Prop[] {
  const rng = new Rng(track.seed * 31 + 7);
  const props: Prop[] = [];
  const edge = ROAD_HALF_WIDTH + SHOULDER_WIDTH;

  for (let s = 30; s < track.length - 30; s += 4) {
    const w = track.biomeWeights(s);
    const biome = pickBiome(w, rng.next());
    for (const side of [-1, 1]) {
      const p = biome === "forest" ? 0.42 : biome === "alpine" ? 0.16 : side < 0 ? 0.04 : 0.12;
      if (!rng.chance(p)) continue;
      const near = biome === "forest" ? 3.5 : 5;
      const d = side * (edge + near + Math.pow(rng.next(), 1.6) * 22);
      let kind: PropKind;
      const r = rng.next();
      if (biome === "forest") kind = r < 0.62 ? "redwood" : r < 0.92 ? "pine" : "rock";
      else if (biome === "alpine") kind = r < 0.55 ? "pine" : r < 0.8 ? "boulder" : "rock";
      else kind = r < 0.55 ? "cypress" : "rock";
      const scale =
        kind === "redwood" ? rng.range(0.85, 1.4) : kind === "boulder" ? rng.range(0.8, 1.6) : rng.range(0.7, 1.25);
      const radius =
        kind === "redwood" ? 0.9 * scale : kind === "pine" || kind === "cypress" ? 0.45 * scale : kind === "boulder" ? 1.4 * scale : 0.6 * scale;
      props.push({ kind, s: s + rng.range(-1.5, 1.5), d, radius, scale, rot: rng.range(0, Math.PI * 2) });
    }
  }

  // Telephone poles along the coast road, inland side.
  for (let s = 60; s < track.length; s += 55) {
    if (track.biomeWeights(s).coast < 0.5) continue;
    props.push({ kind: "pole", s, d: edge + 4.5, radius: 0.25, scale: 1, rot: 0 });
  }

  // Chevron warning signs on the outside of sharp bends.
  const f = newFrame();
  for (let s = 100; s < track.length - 100; s += 14) {
    const c = track.frame(s, f).curve;
    if (Math.abs(c) < 1 / 140) continue;
    // Outside of a right-hander (c > 0) is the left side.
    const side = c > 0 ? -1 : 1;
    props.push({ kind: "chevron", s, d: side * (edge + 1.6), radius: 0.15, scale: 1, rot: 0 });
  }

  // Keep the start grid clear.
  const clear = props.filter((p) => !(p.s < track.startLine + 40 && Math.abs(p.d) < edge + 8));
  clear.sort((a, b) => a.s - b.s);
  return clear;
}

/** Index of the first prop with s >= target (props sorted by s). */
export function lowerBound(props: readonly Prop[], target: number): number {
  let lo = 0;
  let hi = props.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (props[mid].s < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
