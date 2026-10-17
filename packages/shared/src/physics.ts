import { attackDuration, attackSpec } from "./combat.ts";
import { DT, ROAD_HALF_WIDTH, SHOULDER_WIDTH } from "./constants.ts";
import { Attack, type RiderInput, type RiderState } from "./rider.ts";
import { clamp, type Rng } from "./rng.ts";
import { COLLIDE_MAX_D, lowerBound, type Prop } from "./scenery.ts";
import { newFrame, type Track } from "./track.ts";
import type { Car } from "./traffic.ts";

export type CrashCause = "car" | "prop" | "knockout";

export type SimEvent =
  | { type: "start" }
  | { type: "hit"; attacker: number; target: number; attack: Attack; side: number }
  | { type: "crash"; rider: number; cause: CrashCause; by?: number }
  | { type: "remount"; rider: number }
  | { type: "bump"; a: number; b: number; strength: number }
  | { type: "finish"; rider: number; place: number };

export interface SimContext {
  track: Track;
  props: Prop[];
  cars: Car[];
  riders: RiderState[];
  rng: Rng;
  events: SimEvent[];
  tick: number;
  /**
   * False on clients predicting their own rider: attacks animate but only the server
   * decides whether they land.
   */
  authority: boolean;
  /**
   * Where `target` was on the attacker's screen. The server uses this to judge hits from
   * the attacker's (slightly delayed) view of the world. Defaults to the current position.
   */
  rewind?: (attacker: RiderState, target: RiderState) => { s: number; d: number } | null;
}

/** Lateral push from centrifugal force, per (m/s)² of speed per unit curvature. */
export const DRIFT_K = 0.16;
const GEARS = [0.2, 0.36, 0.53, 0.72, 0.9, 1.08];
const RIDER_RADIUS = 0.45;
const frame = newFrame();

export function steerAuthority(r: RiderState, offroad: boolean): number {
  const v = r.speed;
  return (3 + 7 * Math.min(v / 22, 1) - Math.max(0, v - 50) * 0.06) * r.bike.grip * (offroad ? 0.75 : 1);
}

export function topSpeed(r: RiderState): number {
  return r.bike.topSpeed * (1 - Math.min(r.bikeDamage, 100) * 0.0015) * (r.human ? 1 : r.boost);
}

export function stepRiding(r: RiderState, input: RiderInput, ctx: SimContext): void {
  const { track } = ctx;
  const f = track.frame(r.s, frame);
  const absD = Math.abs(r.d);
  const edge = ROAD_HALF_WIDTH + SHOULDER_WIDTH;
  const offroad = absD > edge;
  const onShoulder = !offroad && absD > ROAD_HALF_WIDTH;

  if (r.stagger > 0) r.stagger--;
  if (r.invulnerable > 0) r.invulnerable--;
  r.health = Math.min(100, r.health + 1.5 * DT);

  // --- Longitudinal ---
  let top = topSpeed(r);
  if (offroad) top = Math.min(top, 26);
  const throttle = r.stagger > 0 ? input.throttle * 0.5 : input.throttle;
  let a = 0;
  if (throttle > 0) a += r.bike.accel * throttle * Math.pow(Math.max(0, 1 - r.speed / top), 0.7);
  a -= 0.5 + 0.00025 * r.speed * r.speed;
  if (r.speed > top) a -= (r.speed - top) * 1.2;
  if (input.brake > 0) a -= r.bike.brake * input.brake;
  if (offroad) a -= 3 + r.speed * 0.06;
  else if (onShoulder) a -= 0.8;
  a -= 9.81 * f.slope * 0.55;
  r.speed = Math.max(0, r.speed + a * DT);

  // --- Lateral ---
  const auth = steerAuthority(r, offroad);
  let steerVel = input.steer * auth * (r.stagger > 0 ? 0.4 : 1);
  if (r.speed < 4) steerVel *= r.speed / 4;
  r.vd += (steerVel - r.vd) * Math.min(1, DT * 7);
  const drift = -f.curve * r.speed * r.speed * DRIFT_K;
  r.d += (r.vd + drift) * DT;
  const limit = COLLIDE_MAX_D - 2;
  if (Math.abs(r.d) > limit) {
    r.d = Math.sign(r.d) * limit;
    r.vd = 0;
    r.speed *= 0.97;
  }

  const targetLean = clamp(input.steer * 0.45 * Math.min(r.speed / 18, 1) + f.curve * r.speed * r.speed * 0.045, -0.85, 0.85);
  r.lean += (targetLean - r.lean) * Math.min(1, DT * 7);

  // Gearbox, purely for sound and the tacho.
  const ratio = r.speed / r.bike.topSpeed;
  let g = 0;
  while (g < GEARS.length - 1 && ratio > GEARS[g]) g++;
  const lo = g === 0 ? 0 : GEARS[g - 1];
  r.gear = g + 1;
  r.rpm = clamp(0.25 + ((ratio - lo) / (GEARS[g] - lo)) * 0.75, 0.15, 1);

  r.s += r.speed * DT;

  // --- Attacks ---
  stepAttack(r, input, ctx);

  // --- Collisions with the world ---
  collideProps(r, ctx);
  if (r.mode === "riding") collideCars(r, ctx);
}

function stepAttack(r: RiderState, input: RiderInput, ctx: SimContext): void {
  if (r.attackCooldown > 0) r.attackCooldown--;
  if (input.attack !== Attack.None && r.attack === Attack.None && r.attackCooldown === 0 && r.stagger === 0) {
    r.attack = input.attack;
    r.attackSide = input.attackSide;
    r.attackT = 0;
    r.attackHit = false;
  }
  if (r.attack === Attack.None) return;
  const spec = attackSpec(r.attack)!;
  r.attackT++;
  if (ctx.authority && !r.attackHit && r.attackT > spec.windup && r.attackT <= spec.windup + spec.active) {
    let best: RiderState | null = null;
    let bestGap = Infinity;
    for (const o of ctx.riders) {
      if (o === r || o.mode !== "riding" || o.invulnerable > 0) continue;
      const seen = ctx.rewind?.(r, o) ?? o;
      const ds = Math.abs(seen.s - r.s);
      if (ds > spec.window) continue;
      const dd = (seen.d - r.d) * r.attackSide;
      if (dd < spec.minReach || dd > spec.reach) continue;
      const gap = ds + dd;
      if (gap < bestGap) {
        bestGap = gap;
        best = o;
      }
    }
    if (best) {
      r.attackHit = true;
      best.health -= spec.damage;
      best.vd += r.attackSide * spec.knock;
      best.stagger = 18;
      best.staggerSide = r.attackSide;
      best.attack = Attack.None;
      best.grudge = r.id;
      best.speed *= 0.97;
      ctx.events.push({ type: "hit", attacker: r.id, target: best.id, attack: r.attack, side: r.attackSide });
      if (best.health <= 0) {
        best.health = 0;
        startCrash(best, ctx, "knockout", best.speed * 0.7, r.attackSide * 4, r.id);
      }
    }
  }
  if (r.attackT >= attackDuration(r.attack)) {
    r.attack = Attack.None;
    r.attackCooldown = 4;
  }
}

function collideProps(r: RiderState, ctx: SimContext): void {
  if (Math.abs(r.d) < ROAD_HALF_WIDTH + SHOULDER_WIDTH) return;
  const props = ctx.props;
  for (let i = lowerBound(props, r.s - 3); i < props.length && props[i].s < r.s + 3; i++) {
    const p = props[i];
    if (p.radius <= 0) continue;
    const ds = p.s - r.s;
    const dd = p.d - r.d;
    const rr = p.radius + RIDER_RADIUS;
    if (ds * ds + dd * dd > rr * rr) continue;
    if (r.speed > 7) {
      startCrash(r, ctx, "prop", r.speed * 0.3, -Math.sign(dd) * 2);
      r.bikeDamage = Math.min(100, r.bikeDamage + 14);
    } else {
      // Low speed: just stop against it.
      r.speed = 0;
      r.d -= Math.sign(dd) * 0.1;
    }
    return;
  }
}

function collideCars(r: RiderState, ctx: SimContext): void {
  for (const c of ctx.cars) {
    const ds = c.s - r.s;
    if (Math.abs(ds) > c.length / 2 + 1.1) continue;
    const dd = c.d - r.d;
    if (Math.abs(dd) > c.width / 2 + RIDER_RADIUS) continue;
    const rel = r.speed - c.speed;
    if (Math.abs(rel) > 8) {
      // Thrown over the bonnet, or flung backwards by oncoming traffic.
      startCrash(r, ctx, "car", c.speed * 0.6 + r.speed * 0.25, -Math.sign(dd) * 3);
      r.bikeDamage = Math.min(100, r.bikeDamage + 22);
    } else {
      r.speed = Math.max(0, c.speed - 2);
      r.vd -= Math.sign(dd) * 2;
    }
    return;
  }
}

export function startCrash(r: RiderState, ctx: SimContext, cause: CrashCause, bodyVs: number, bodyVd: number, by?: number): void {
  const rng = ctx.rng;
  r.mode = "crashing";
  r.attack = Attack.None;
  r.stagger = 0;
  r.crash = {
    bodyS: r.s,
    bodyD: r.d,
    bodyH: 0.9,
    bodyVs,
    bodyVd: bodyVd + r.vd * 0.5 + rng.range(-1.5, 1.5),
    bodyVh: 3 + Math.min(r.speed, 60) * 0.08,
    bodySpin: rng.range(5, 11) * (rng.chance(0.5) ? 1 : -1),
    bodyRot: 0,
    bikeS: r.s,
    bikeD: r.d,
    bikeVs: cause === "knockout" ? r.speed * 0.8 : r.speed * 0.25,
    bikeVd: r.vd * 0.6 + bodyVd * 0.3,
    bikeRot: 0,
    bikeSpin: rng.range(-4, 4),
    t: 0,
    rest: 0,
  };
  r.speed = 0;
  r.vd = 0;
  ctx.events.push({ type: "crash", rider: r.id, cause, by });
}

const approachZero = (v: number, amount: number) => (Math.abs(v) <= amount ? 0 : v - Math.sign(v) * amount);

export function stepCrashing(r: RiderState, ctx: SimContext): void {
  const c = r.crash!;
  c.t++;
  c.bodyVh -= 22 * DT;
  c.bodyH += c.bodyVh * DT;
  const grounded = c.bodyH <= 0;
  if (grounded) {
    c.bodyH = 0;
    if (c.bodyVh < -2.5) {
      c.bodyVh = -c.bodyVh * 0.35;
      c.bodySpin *= 0.6;
    } else c.bodyVh = 0;
    c.bodyVs = approachZero(c.bodyVs, 16 * DT);
    c.bodyVd = approachZero(c.bodyVd, 16 * DT);
    c.bodySpin *= 0.94;
  }
  c.bodyS += c.bodyVs * DT;
  c.bodyD = clamp(c.bodyD + c.bodyVd * DT, -COLLIDE_MAX_D, COLLIDE_MAX_D);
  c.bodyRot += c.bodySpin * DT;

  c.bikeVs = approachZero(c.bikeVs, 9 * DT);
  c.bikeVd = approachZero(c.bikeVd, 9 * DT);
  c.bikeS += c.bikeVs * DT;
  c.bikeD = clamp(c.bikeD + c.bikeVd * DT, -COLLIDE_MAX_D + 1, COLLIDE_MAX_D - 1);
  c.bikeRot += c.bikeSpin * DT;
  c.bikeSpin *= 0.97;

  // Keep the rider's track position on the body so cameras and placings follow it.
  r.s = c.bodyS;
  r.d = c.bodyD;

  if (grounded && Math.abs(c.bodyVs) < 0.8 && c.bodyVh === 0) c.rest++;
  if (c.rest > 36 && c.t > 70) r.mode = "running";
  void ctx;
}

const RUN_SPEED = 7.5;

export function stepRunning(r: RiderState, ctx: SimContext): void {
  const c = r.crash!;
  const ds = c.bikeS - r.s;
  const dd = c.bikeD - r.d;
  const dist = Math.hypot(ds, dd);
  if (dist < 0.9) {
    r.mode = "riding";
    r.s = c.bikeS;
    r.d = c.bikeD;
    r.speed = 0;
    r.vd = 0;
    r.lean = 0;
    r.crash = null;
    r.health = Math.max(r.health, 70);
    r.invulnerable = 90;
    ctx.events.push({ type: "remount", rider: r.id });
    return;
  }
  const step = Math.min(dist, RUN_SPEED * DT);
  r.s += (ds / dist) * step;
  r.d += (dd / dist) * step;
  c.bodyS = r.s;
  c.bodyD = r.d;
  c.t++;
}

/** Riders bumping shoulders. Pushes them apart and lets the rear rider lose a little speed. */
export function collideRiders(ctx: SimContext): void {
  const rs = ctx.riders;
  for (let i = 0; i < rs.length; i++) {
    const a = rs[i];
    if (a.mode !== "riding") continue;
    for (let j = i + 1; j < rs.length; j++) {
      const b = rs[j];
      if (b.mode !== "riding") continue;
      const ds = b.s - a.s;
      if (Math.abs(ds) > 1.9) continue;
      const dd = b.d - a.d;
      if (Math.abs(dd) > 0.9) continue;
      const overlap = 0.9 - Math.abs(dd);
      const dir = dd === 0 ? (a.id < b.id ? 1 : -1) : Math.sign(dd);
      const push = overlap * 7;
      const total = a.bike.mass + b.bike.mass;
      a.vd -= dir * push * (b.bike.mass / total);
      b.vd += dir * push * (a.bike.mass / total);
      a.d -= dir * overlap * 0.5;
      b.d += dir * overlap * 0.5;
      const rear = ds > 0 ? a : b;
      rear.speed *= 0.995;
      if (overlap > 0.3) ctx.events.push({ type: "bump", a: a.id, b: b.id, strength: overlap });
    }
  }
}
