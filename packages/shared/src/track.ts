import { SAMPLE_SPACING } from "./constants.ts";
import { Rng, clamp, smoothstep } from "./rng.ts";

export type Biome = "coast" | "forest" | "alpine";
export const BIOMES: readonly Biome[] = ["coast", "forest", "alpine"];

export interface BiomeZone {
  biome: Biome;
  start: number;
  end: number;
}

export interface TrackFrame {
  x: number;
  y: number;
  z: number;
  /** Horizontal unit forward. */
  fx: number;
  fz: number;
  /** Horizontal unit right (rider's right hand side). */
  rx: number;
  rz: number;
  heading: number;
  /** Signed curvature, 1/m. Positive bends to the right. */
  curve: number;
  /** Rise over run. */
  slope: number;
}

export const newFrame = (): TrackFrame => ({ x: 0, y: 0, z: 0, fx: 0, fz: 1, rx: -1, rz: 0, heading: 0, curve: 0, slope: 0 });

interface Section {
  length: number;
  curve: number;
  slope: number;
}

const ease = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

/**
 * A point-to-point road, stored as evenly spaced centreline samples.
 * Everything in the simulation lives in track space: s (metres along the road) and
 * d (metres right of the centreline). World positions are derived from the frame at s.
 */
export class Track {
  readonly seed: number;
  readonly length: number;
  readonly count: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  readonly heading: Float64Array;
  readonly curve: Float64Array;
  readonly slope: Float64Array;
  readonly zones: BiomeZone[];
  readonly startLine: number;
  readonly finishLine: number;

  private grid?: Map<number, number[]>;
  private static readonly CELL = 24;

  constructor(seed: number, sections: Section[], zones: BiomeZone[], startLine: number, finishTail: number) {
    this.seed = seed;
    const total = sections.reduce((a, s) => a + s.length, 0);
    this.count = Math.floor(total / SAMPLE_SPACING) + 1;
    this.length = (this.count - 1) * SAMPLE_SPACING;
    this.x = new Float64Array(this.count);
    this.y = new Float64Array(this.count);
    this.z = new Float64Array(this.count);
    this.heading = new Float64Array(this.count);
    this.curve = new Float64Array(this.count);
    this.slope = new Float64Array(this.count);
    this.zones = zones;
    this.startLine = startLine;
    this.finishLine = this.length - finishTail;

    // Lay out per-sample curve/slope with eased in/out ramps inside each section.
    let i = 0;
    let prevCurve = 0;
    let prevSlope = 0;
    for (const sec of sections) {
      const n = Math.round(sec.length / SAMPLE_SPACING);
      const ramp = Math.max(1, Math.floor(n * 0.3));
      for (let k = 0; k < n && i < this.count; k++, i++) {
        // Each section eases in from the previous section's values over its first 30%.
        const t = ease(k / ramp);
        this.curve[i] = prevCurve + (sec.curve - prevCurve) * t;
        this.slope[i] = prevSlope + (sec.slope - prevSlope) * t;
      }
      prevCurve = sec.curve;
      prevSlope = sec.slope;
    }
    for (; i < this.count; i++) {
      this.curve[i] = prevCurve;
      this.slope[i] = prevSlope;
    }

    // Integrate centreline.
    let h = 0;
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let j = 0; j < this.count; j++) {
      this.x[j] = px;
      this.y[j] = py;
      this.z[j] = pz;
      this.heading[j] = h;
      // Positive curve turns right; right of forward (sin h, cos h) is (-cos h, sin h),
      // which is the direction of decreasing heading.
      h -= this.curve[j] * SAMPLE_SPACING;
      px += Math.sin(h) * SAMPLE_SPACING;
      pz += Math.cos(h) * SAMPLE_SPACING;
      py += this.slope[j] * SAMPLE_SPACING;
    }
  }

  /** Fills `out` with the interpolated frame at distance s (clamped to the track). */
  frame(s: number, out: TrackFrame): TrackFrame {
    const f = clamp(s / SAMPLE_SPACING, 0, this.count - 1.0001);
    const i = Math.floor(f);
    const t = f - i;
    const j = i + 1;
    out.x = this.x[i] + (this.x[j] - this.x[i]) * t;
    out.y = this.y[i] + (this.y[j] - this.y[i]) * t;
    out.z = this.z[i] + (this.z[j] - this.z[i]) * t;
    const h = this.heading[i] + (this.heading[j] - this.heading[i]) * t;
    out.heading = h;
    out.fx = Math.sin(h);
    out.fz = Math.cos(h);
    out.rx = -Math.cos(h);
    out.rz = Math.sin(h);
    out.curve = this.curve[i] + (this.curve[j] - this.curve[i]) * t;
    out.slope = this.slope[i] + (this.slope[j] - this.slope[i]) * t;
    return out;
  }

  /** Road surface height at s. */
  heightAt(s: number): number {
    const f = clamp(s / SAMPLE_SPACING, 0, this.count - 1.0001);
    const i = Math.floor(f);
    return this.y[i] + (this.y[i + 1] - this.y[i]) * (f - i);
  }

  /** Weights for each biome at s; they sum to 1. Zones cross-fade over 250 m. */
  biomeWeights(s: number): Record<Biome, number> {
    const w: Record<Biome, number> = { coast: 0, forest: 0, alpine: 0 };
    const fade = 250;
    let total = 0;
    for (const z of this.zones) {
      const a = smoothstep(z.start - fade, z.start + fade, s) * (1 - smoothstep(z.end - fade, z.end + fade, s));
      w[z.biome] += a;
      total += a;
    }
    if (total <= 0) {
      w.forest = 1;
      return w;
    }
    for (const b of BIOMES) w[b] /= total;
    return w;
  }

  /**
   * Projects a world XZ point onto the track: returns the nearest sample's s and the
   * signed lateral offset d. Uses a lazily built spatial grid.
   */
  project(x: number, z: number, out: { s: number; d: number; dist: number }): typeof out {
    const grid = this.ensureGrid();
    const C = Track.CELL;
    const cx = Math.floor(x / C);
    const cz = Math.floor(z / C);
    let best = -1;
    let bestD2 = Infinity;
    for (let r = 1; r <= 12 && best < 0; r += 3) {
      for (let gx = cx - r; gx <= cx + r; gx++) {
        for (let gz = cz - r; gz <= cz + r; gz++) {
          const cell = grid.get(gx * 73856093 ^ gz * 19349663);
          if (!cell) continue;
          for (const idx of cell) {
            const dx = this.x[idx] - x;
            const dz = this.z[idx] - z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = idx;
            }
          }
        }
      }
    }
    if (best < 0) {
      out.s = 0;
      out.d = 1e6;
      out.dist = 1e6;
      return out;
    }
    const h = this.heading[best];
    const dx = x - this.x[best];
    const dz = z - this.z[best];
    const along = dx * Math.sin(h) + dz * Math.cos(h);
    out.s = clamp(best * SAMPLE_SPACING + along, 0, this.length);
    out.d = dx * -Math.cos(h) + dz * Math.sin(h);
    out.dist = Math.sqrt(bestD2);
    return out;
  }

  private ensureGrid(): Map<number, number[]> {
    if (this.grid) return this.grid;
    const g = new Map<number, number[]>();
    const C = Track.CELL;
    for (let i = 0; i < this.count; i++) {
      const key = Math.floor(this.x[i] / C) * 73856093 ^ Math.floor(this.z[i] / C) * 19349663;
      let cell = g.get(key);
      if (!cell) g.set(key, (cell = []));
      cell.push(i);
    }
    this.grid = g;
    return g;
  }
}

/**
 * Builds a long, flowing point-to-point road. The generator keeps the overall heading
 * within a cone so the road never loops back over itself.
 */
export function generateTrack(seed: number): Track {
  const rng = new Rng(seed);
  const sections: Section[] = [];
  const startStraight = 220;
  const finishTail = 260;
  sections.push({ length: startStraight, curve: 0, slope: 0 });

  const zonePlan: { biome: Biome; length: number }[] = [
    { biome: "coast", length: 2600 },
    { biome: "forest", length: 2800 },
    { biome: "alpine", length: 2400 },
  ];

  let heading = 0;
  let total = startStraight;
  const zones: BiomeZone[] = [];
  let zoneStart = 0;
  for (const zp of zonePlan) {
    const zoneEnd = zoneStart + zp.length + (zoneStart === 0 ? startStraight : 0);
    zones.push({ biome: zp.biome, start: zoneStart, end: zoneEnd });
    // Biome personality: coast = sweeping & flat, forest = twisty & rolling, alpine = hairpins & climbs.
    const style =
      zp.biome === "coast"
        ? { maxCurve: 1 / 160, minLen: 120, maxLen: 320, maxSlope: 0.025, straightChance: 0.3, climb: 0 }
        : zp.biome === "forest"
          ? { maxCurve: 1 / 95, minLen: 80, maxLen: 220, maxSlope: 0.06, straightChance: 0.2, climb: 0.008 }
          : { maxCurve: 1 / 70, minLen: 70, maxLen: 200, maxSlope: 0.08, straightChance: 0.15, climb: 0.02 };
    while (total < zoneEnd) {
      const len = Math.round(rng.range(style.minLen, style.maxLen));
      let curve = 0;
      if (!rng.chance(style.straightChance)) {
        const mag = rng.range(0.25, 1) * style.maxCurve;
        // Steer back toward the corridor if we have drifted too far either way.
        let sign = rng.chance(0.5) ? 1 : -1;
        if (heading > 0.9) sign = 1;
        else if (heading < -0.9) sign = -1;
        curve = sign * mag;
        // Avoid turning so much in one section that we leave the corridor.
        const turn = curve * len * 0.75;
        if (Math.abs(heading - turn) > 1.3) curve *= 0.3;
      }
      const slope = clamp(rng.range(-style.maxSlope, style.maxSlope) + style.climb, -0.09, 0.09);
      sections.push({ length: len, curve, slope });
      heading -= curve * len * 0.75;
      total += len;
    }
    zoneStart = zoneEnd;
  }
  // Ease out into the finish straight.
  sections.push({ length: finishTail, curve: 0, slope: 0 });
  zones[zones.length - 1].end = total + finishTail + 1000;
  return new Track(seed, sections, zones, startStraight - 40, finishTail - 60);
}
