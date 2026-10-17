import {

  Race,
  TICK_RATE,
  applyNetState,
  placeTraffic,
  stepCrashing,
  stepRiding,
  stepRunning,
  type InputFrame,
  type RacerEntry,
  type RiderInput,
  type RiderNetState,
  type RiderState,
  type SimContext,
  type SimEvent,
  type Snapshot,
} from "@rr/shared";
import type { Net } from "./net.ts";

/** Other riders are drawn this many ticks in the past, so there's always a snapshot either side. */
const INTERP_TICKS = 6;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Client side of an online race.
 *
 * - Our own rider is predicted locally from our inputs and corrected when the server's
 *   authoritative state arrives (replaying inputs it hasn't seen yet).
 * - Everyone else is interpolated between snapshots, a little in the past.
 * - Traffic is a function of time, so we just place it ourselves.
 */
export class OnlineRace {
  readonly race: Race;
  readonly me: RiderState;
  private readonly buffer: Snapshot[] = [];
  private readonly pending: InputFrame[] = [];
  private readonly queued: { tick: number; e: SimEvent }[] = [];
  private seq = 0;
  private renderTick = 0;
  private latestTick = 0;
  private started = false;
  /** Visual-only offset that hides prediction corrections; decays to zero. */
  readonly error = { s: 0, d: 0 };
  private readonly ctx: SimContext;

  constructor(
    private readonly net: Net,
    entries: RacerEntry[],
    seed: number,
    readonly riderId: number,
  ) {
    this.race = new Race(seed, entries);
    this.me = this.race.riders[riderId];
    // Prediction context: attacks animate but never resolve locally.
    this.ctx = {
      track: this.race.track,
      props: this.race.props,
      cars: this.race.cars,
      riders: this.race.riders,
      rng: this.race.rng,
      events: [],
      tick: 0,
      authority: false,
    };
  }

  get rttTicks() {
    return (this.net.rtt / 1000) * TICK_RATE;
  }

  /** Server tick our inputs will land on: what the world "really" is for us right now. */
  private get predictedTick() {
    return this.renderTick + INTERP_TICKS + this.rttTicks;
  }

  receive(s: Snapshot): void {
    if (s.tick <= this.latestTick && this.buffer.length) return;
    this.buffer.push(s);
    while (this.buffer.length > 2 && this.buffer[1].tick < this.renderTick - 30) this.buffer.shift();
    if (this.latestTick === 0) this.renderTick = s.tick - INTERP_TICKS;
    this.latestTick = s.tick;
    this.race.phase = s.phase;
    this.race.countdown = s.countdown;
    this.race.tick = s.tick;
    for (const e of s.events) this.queued.push({ tick: s.tick, e });
    this.reconcile(s);
  }

  private predict(input: RiderInput): void {
    const me = this.me;
    this.ctx.tick = Math.round(this.predictedTick);
    switch (me.mode) {
      case "riding":
        stepRiding(me, input, this.ctx);
        break;
      case "crashing":
        stepCrashing(me, this.ctx);
        break;
      case "running":
        stepRunning(me, this.ctx);
        break;
    }
    this.ctx.events.length = 0;
  }

  private reconcile(s: Snapshot): void {
    const me = this.me;
    const beforeS = me.s;
    const beforeD = me.d;
    applyNetState(me, s.riders[this.riderId]);
    while (this.pending.length && this.pending[0].seq <= s.ackSeq) this.pending.shift();
    if (s.phase === "racing") {
      this.started = true;
      for (const f of this.pending) this.predict(f.input);
    }
    if (me.mode === "riding") {
      this.error.s += beforeS - me.s;
      this.error.d += beforeD - me.d;
      // Big disagreements (respawns, teleports) snap rather than glide.
      if (Math.abs(this.error.s) > 8 || Math.abs(this.error.d) > 4) this.error.s = this.error.d = 0;
    } else {
      this.error.s = this.error.d = 0;
    }
  }

  /** One local 60 Hz tick. Returns events whose moment has come on our (delayed) timeline. */
  tick(input: RiderInput): SimEvent[] {
    // Send input.
    const f: InputFrame = { seq: ++this.seq, viewTick: Math.max(0, Math.round(this.renderTick)), input: { ...input } };
    this.pending.push(f);
    if (this.pending.length > 180) this.pending.shift();
    this.net.sendInput(f);

    // Predict ourselves.
    if (this.started) this.predict(input);
    else this.me.rpm += (0.15 + input.throttle * 0.8 - this.me.rpm) * 0.12;

    // Advance the interpolation clock and steer it toward the newest data.
    this.renderTick += 1;
    const target = this.latestTick - INTERP_TICKS;
    const drift = target - this.renderTick;
    if (Math.abs(drift) > 20) this.renderTick = target;
    else this.renderTick += drift * 0.05;

    this.interpolateOthers();
    placeTraffic(this.race.cars, this.race.track, Math.round(this.predictedTick));

    this.error.s *= 0.88;
    this.error.d *= 0.88;

    const out: SimEvent[] = [];
    while (this.queued.length && this.queued[0].tick <= this.renderTick) out.push(this.queued.shift()!.e);
    return out;
  }

  private interpolateOthers(): void {
    const b = this.buffer;
    if (!b.length) return;
    const rt = this.renderTick;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].tick > rt) i--;
    const next = b[i];
    const prev = i > 0 ? b[i - 1] : next;
    const span = next.tick - prev.tick;
    const t = span > 0 ? Math.min(1, Math.max(0, (rt - prev.tick) / span)) : 1;
    this.race.riders.forEach((r, k) => {
      if (k === this.riderId) return;
      const a = prev.riders[k];
      const n = next.riders[k];
      applyNetState(r, n);
      blend(r, a, n, t);
    });
  }

  /** Snaps everyone to the newest server state (e.g. for the results table). */
  syncAll(): void {
    const latest = this.buffer[this.buffer.length - 1];
    if (!latest) return;
    this.race.riders.forEach((r, k) => applyNetState(r, latest.riders[k]));
  }

  get time(): number {
    return this.race.time;
  }
}

function blend(r: RiderState, a: RiderNetState, b: RiderNetState, t: number): void {
  if (a.mode !== b.mode) return;
  r.s = lerp(a.s, b.s, t);
  r.d = lerp(a.d, b.d, t);
  r.lean = lerp(a.lean, b.lean, t);
  r.speed = lerp(a.speed, b.speed, t);
  if (r.crash && a.crash && b.crash) {
    r.crash.bodyS = lerp(a.crash.bodyS, b.crash.bodyS, t);
    r.crash.bodyD = lerp(a.crash.bodyD, b.crash.bodyD, t);
    r.crash.bodyH = lerp(a.crash.bodyH, b.crash.bodyH, t);
    r.crash.bodyRot = lerp(a.crash.bodyRot, b.crash.bodyRot, t);
    r.crash.bikeS = lerp(a.crash.bikeS, b.crash.bikeS, t);
    r.crash.bikeD = lerp(a.crash.bikeD, b.crash.bikeD, t);
    r.crash.bikeRot = lerp(a.crash.bikeRot, b.crash.bikeRot, t);
  }
}

