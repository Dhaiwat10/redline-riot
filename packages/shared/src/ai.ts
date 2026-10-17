import { COUNTDOWN_TICKS, ROAD_HALF_WIDTH, TICK_RATE } from "./constants.ts";
import { DRIFT_K, steerAuthority, topSpeed, type SimContext } from "./physics.ts";
import { Attack, type RiderInput, type RiderState } from "./rider.ts";
import { clamp } from "./rng.ts";
import { newFrame } from "./track.ts";

const here = newFrame();
const ahead = newFrame();
const LANES = [-5, -2.5, 0, 2.5, 5];

/** Lowest s among humans still racing, used for rubber-banding. */
function humanAnchor(ctx: SimContext): number | null {
  let best: number | null = null;
  for (const r of ctx.riders) if (r.human && !r.finished) best = best === null ? r.s : Math.max(best, r.s);
  return best;
}

export function think(r: RiderState, ctx: SimContext, out: RiderInput): RiderInput {
  const { track } = ctx;
  const p = r.personality;
  const f = track.frame(r.s, here);
  const v = r.speed;

  // Rubber band so the pack stays around the humans. Gentle: a skilled player still pulls away.
  const anchor = humanAnchor(ctx);
  if (anchor !== null && !r.finished) {
    const gap = anchor - r.s; // positive: we're behind
    r.boost = 1 + clamp(gap / 500, -0.08, 0.1);
  } else r.boost = 1;

  // --- Speed: how fast can we take the sharpest bend coming up? ---
  let maxCurve = 0;
  let curveSign = 0;
  for (const la of [8, 20, 35, 55, 80]) {
    const c = track.frame(r.s + la + v * 0.5, ahead).curve;
    if (Math.abs(c) > maxCurve) {
      maxCurve = Math.abs(c);
      curveSign = Math.sign(c);
    }
  }
  const auth = steerAuthority(r, false);
  const vCurve = Math.sqrt((auth * (0.55 + 0.3 * p.skill)) / (DRIFT_K * Math.max(maxCurve, 1e-5)));
  const target = Math.min(topSpeed(r) * p.skill, vCurve);
  out.throttle = v < target ? 1 : 0;
  out.brake = v > target + 5 ? 0.7 : 0;

  // --- Line: preferred offset, cut toward the inside of bends ---
  let targetD = p.line + curveSign * Math.min(2.5, maxCurve * 260);

  // --- Fights: close in on a nearby rider and swing at them ---
  out.attack = Attack.None;
  let foe: RiderState | null = null;
  let foeScore = Infinity;
  for (const o of ctx.riders) {
    if (o === r || o.mode !== "riding") continue;
    const ds = Math.abs(o.s - r.s);
    if (ds > 8 || o.s < r.s - 4) continue;
    const score = ds - (o.id === r.grudge ? 6 : 0) - (o.human ? 2 : 0);
    if (score < foeScore) {
      foeScore = score;
      foe = o;
    }
  }
  const angry = foe && foe.id === r.grudge ? 0.35 : 0;
  let fighting = false;
  if (foe && p.aggression + angry > 0.25) {
    fighting = true;
    const side = foe.d >= r.d ? 1 : -1;
    targetD = foe.d - side * 1.15;
    const dd = Math.abs(foe.d - r.d);
    const ds = Math.abs(foe.s - r.s);
    // Ease off to let a slower foe draw alongside, but never stall the race for it.
    if (foe.s < r.s - 1.5 && v > foe.speed + 1.5 && v > 0.6 * r.bike.topSpeed) out.throttle = 0;
    if (ds < 2 && dd > 0.3 && dd < 2.1 && r.attack === Attack.None && r.stagger === 0) {
      // Give everyone a few seconds to get going before the first punches fly.
      const grace = ctx.tick < COUNTDOWN_TICKS + 6 * TICK_RATE;
      if (!grace && ctx.rng.chance((p.aggression + angry) * 0.035)) {
        out.attack = dd > 1.55 ? Attack.Kick : Attack.Punch;
        out.attackSide = side;
      }
    }
  }

  // --- Traffic: if our line is blocked ahead, pick the nearest clear lane ---
  // Riders mid-fight watch the road less, which is when they plough into traffic.
  const attention = fighting ? 0.35 + 0.3 * p.skill : 1;
  const look = (18 + v * 1.4) * attention;
  const blocked = (d: number) => {
    for (const c of ctx.cars) {
      const ds = c.s - r.s;
      const closing = v - c.speed;
      if (ds < -3 || ds > Math.min(look, (6 + Math.max(0, closing) * 2.2) * attention)) continue;
      if (Math.abs(c.d - d) < c.width / 2 + 1.1) return true;
    }
    return false;
  };
  if (blocked(targetD) || blocked(r.d)) {
    let bestLane = targetD;
    let bestCost = Infinity;
    for (const l of LANES) {
      if (blocked(l)) continue;
      const cost = Math.abs(l - r.d) + Math.abs(l - targetD) * 0.3;
      if (cost < bestCost) {
        bestCost = cost;
        bestLane = l;
      }
    }
    if (bestCost === Infinity) out.brake = 1;
    targetD = bestLane;
  }
  targetD = clamp(targetD, -ROAD_HALF_WIDTH + 0.8, ROAD_HALF_WIDTH - 0.8);

  // --- Steering: P-controller on lateral error plus drift compensation ---
  const drift = f.curve * v * v * DRIFT_K;
  out.steer = clamp(((targetD - r.d) * 2.2 - r.vd * 0.35 + drift) / Math.max(auth, 1), -1, 1);
  return out;
}
