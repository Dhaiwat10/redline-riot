import { isTouchDevice } from "./touch.ts";

export interface Quality {
  mobile: boolean;
  maxPixelRatio: number;
  minPixelRatio: number;
  shadowSize: number;
  smaa: boolean;
  chromatic: boolean;
  /** Terrain streaming radius and fog distance, metres. */
  viewDistance: number;
  /** Fraction of decorative scatter (trees/rocks away from the road). */
  scatter: number;
}

export function pickQuality(): Quality {
  const dpr = devicePixelRatio || 1;
  if (isTouchDevice()) {
    return { mobile: true, maxPixelRatio: Math.min(dpr, 1.5), minPixelRatio: 0.6, shadowSize: 1024, smaa: false, chromatic: false, viewDistance: 750, scatter: 0.5 };
  }
  return { mobile: false, maxPixelRatio: Math.min(dpr, 2), minPixelRatio: 0.75, shadowSize: 2048, smaa: true, chromatic: true, viewDistance: 1100, scatter: 1 };
}

/**
 * Nudges render resolution to hold the frame rate: drops quickly when frames are slow,
 * creeps back up when there's headroom.
 */
export class ResolutionScaler {
  private ema = 1 / 60;
  private timer = 0;
  private goodStreak = 0;
  ratio: number;

  constructor(
    private readonly q: Quality,
    private readonly apply: (ratio: number) => void,
  ) {
    this.ratio = q.maxPixelRatio;
  }

  update(dt: number): void {
    // Ignore stalls (tab switches, a backgrounded pane): they say nothing about GPU load.
    if (dt >= 0.1) return;
    this.ema += (dt - this.ema) * 0.05;
    this.timer += dt;
    if (this.timer < 1) return;
    this.timer = 0;
    let next = this.ratio;
    if (this.ema > 1 / 45) {
      next = Math.max(this.q.minPixelRatio, this.ratio - 0.15);
      this.goodStreak = 0;
    } else if (this.ema < 1 / 57) {
      if (++this.goodStreak >= 4) {
        next = Math.min(this.q.maxPixelRatio, this.ratio + 0.1);
        this.goodStreak = 0;
      }
    } else this.goodStreak = 0;
    if (Math.abs(next - this.ratio) > 1e-3) {
      this.ratio = next;
      this.apply(next);
    }
  }
}
