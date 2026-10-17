import type { SimEvent } from "./physics.ts";
import type { RacePhase, RacerEntry } from "./race.ts";
import { Attack, type CrashState, type RiderInput, type RiderMode, type RiderState } from "./rider.ts";

/*
 * Wire protocol. Lobby traffic is small JSON text frames; the two hot paths (client input,
 * server snapshots) are compact binary frames.
 */

export const MAX_HUMANS = 8;
export const RACE_SIZE = 12;
/** Server sends a snapshot every N ticks. */
export const SNAPSHOT_EVERY = 2;

export interface LobbyPlayer {
  id: number;
  name: string;
  colour: number;
  ready: boolean;
  connected: boolean;
}

export type RoomState = "lobby" | "racing" | "results";

export interface RoomInfo {
  code: string;
  public: boolean;
  hostId: number;
  state: RoomState;
  players: LobbyPlayer[];
  /** Epoch ms when a public lobby auto-starts, if counting down. */
  startsAt: number | null;
}

export type ClientMsg =
  | { t: "hello"; name: string; colour: number }
  | { t: "quick" }
  | { t: "create" }
  | { t: "join"; code: string }
  | { t: "ready"; ready: boolean }
  | { t: "start" }
  | { t: "leave" }
  | { t: "ping"; at: number };

export type ServerMsg =
  | { t: "welcome"; playerId: number }
  | { t: "room"; room: RoomInfo }
  | { t: "left" }
  | { t: "start"; seed: number; entries: RacerEntry[]; riderId: number; tick: number }
  | { t: "error"; message: string }
  | { t: "pong"; at: number; serverTick: number };

const enum Kind {
  Input = 1,
  Snapshot = 2,
}

// ---------------------------------------------------------------- bytes

class Writer {
  private buf = new ArrayBuffer(4096);
  private view = new DataView(this.buf);
  private o = 0;
  private ensure(n: number) {
    if (this.o + n <= this.buf.byteLength) return;
    const next = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.o + n));
    new Uint8Array(next).set(new Uint8Array(this.buf));
    this.buf = next;
    this.view = new DataView(next);
  }
  u8(v: number) {
    this.ensure(1);
    this.view.setUint8(this.o++, Math.max(0, Math.min(255, Math.round(v))));
  }
  i8(v: number) {
    this.ensure(1);
    this.view.setInt8(this.o++, Math.max(-128, Math.min(127, Math.round(v))));
  }
  u16(v: number) {
    this.ensure(2);
    this.view.setUint16(this.o, Math.max(0, Math.min(65535, Math.round(v))));
    this.o += 2;
  }
  i16(v: number) {
    this.ensure(2);
    this.view.setInt16(this.o, Math.max(-32768, Math.min(32767, Math.round(v))));
    this.o += 2;
  }
  u32(v: number) {
    this.ensure(4);
    this.view.setUint32(this.o, v >>> 0);
    this.o += 4;
  }
  f32(v: number) {
    this.ensure(4);
    this.view.setFloat32(this.o, v);
    this.o += 4;
  }
  done(): Uint8Array {
    return new Uint8Array(this.buf, 0, this.o).slice();
  }
}

class Reader {
  private view: DataView;
  private o = 0;
  constructor(data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  u8() {
    return this.view.getUint8(this.o++);
  }
  i8() {
    return this.view.getInt8(this.o++);
  }
  u16() {
    const v = this.view.getUint16(this.o);
    this.o += 2;
    return v;
  }
  i16() {
    const v = this.view.getInt16(this.o);
    this.o += 2;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.o);
    this.o += 4;
    return v;
  }
  f32() {
    const v = this.view.getFloat32(this.o);
    this.o += 4;
    return v;
  }
}

export const frameKind = (data: Uint8Array): number => data[0];
export const isInputFrame = (data: Uint8Array) => data[0] === Kind.Input;
export const isSnapshotFrame = (data: Uint8Array) => data[0] === Kind.Snapshot;

// ---------------------------------------------------------------- input

export interface InputFrame {
  seq: number;
  /** The server tick the client was displaying other riders at; used to rewind hit checks. */
  viewTick: number;
  input: RiderInput;
}

export function encodeInput(f: InputFrame): Uint8Array {
  const w = new Writer();
  w.u8(Kind.Input);
  w.u32(f.seq);
  w.u32(f.viewTick);
  w.u8(f.input.throttle * 255);
  w.u8(f.input.brake * 255);
  w.i8(f.input.steer * 127);
  w.u8(f.input.attack);
  w.i8(f.input.attackSide);
  return w.done();
}

export function decodeInput(data: Uint8Array): InputFrame {
  const r = new Reader(data);
  r.u8();
  const seq = r.u32();
  const viewTick = r.u32();
  const throttle = r.u8() / 255;
  const brake = r.u8() / 255;
  const steer = Math.max(-1, r.i8() / 127);
  const attack = r.u8() as Attack;
  const attackSide = (r.i8() < 0 ? -1 : 1) as -1 | 1;
  return { seq, viewTick, input: { throttle, brake, steer, attack, attackSide } };
}

// ---------------------------------------------------------------- snapshots

/** The networked subset of RiderState. */
export type RiderNetState = Pick<
  RiderState,
  | "s"
  | "d"
  | "speed"
  | "vd"
  | "lean"
  | "rpm"
  | "gear"
  | "health"
  | "bikeDamage"
  | "mode"
  | "attack"
  | "attackSide"
  | "attackT"
  | "attackHit"
  | "attackCooldown"
  | "stagger"
  | "staggerSide"
  | "invulnerable"
  | "grudge"
  | "finished"
  | "finishTick"
  | "place"
  | "human"
> & { crash: CrashState | null };

export interface Snapshot {
  tick: number;
  phase: RacePhase;
  countdown: number;
  /** Last input seq the server applied for the recipient. */
  ackSeq: number;
  riders: RiderNetState[];
  events: SimEvent[];
}

const PHASES: RacePhase[] = ["countdown", "racing", "finished"];
const MODES: RiderMode[] = ["riding", "crashing", "running"];
const EVENTS: SimEvent["type"][] = ["start", "hit", "crash", "remount", "bump", "finish"];
const CAUSES = ["car", "prop", "knockout"] as const;

export function encodeSnapshot(s: Snapshot): Uint8Array {
  const w = new Writer();
  w.u8(Kind.Snapshot);
  w.u32(s.tick);
  w.u8(PHASES.indexOf(s.phase));
  w.u16(s.countdown);
  w.u32(s.ackSeq);
  w.u8(s.riders.length);
  for (const r of s.riders) {
    w.f32(r.s);
    w.i16(r.d * 100);
    w.u16(r.speed * 100);
    w.i16(r.vd * 100);
    w.i8(r.lean * 100);
    w.u8(r.rpm * 255);
    w.u8(r.gear);
    w.u8(Math.max(0, r.health) * 2);
    w.u8(r.bikeDamage * 2);
    w.u8(MODES.indexOf(r.mode) | (r.finished ? 8 : 0) | (r.attackHit ? 16 : 0) | (r.human ? 32 : 0));
    w.u8(r.attack);
    w.i8(r.attackSide);
    w.u8(r.attackT);
    w.u8(r.attackCooldown);
    w.u8(r.stagger);
    w.i8(r.staggerSide);
    w.u8(r.invulnerable);
    w.i8(r.grudge);
    w.u8(r.place);
    w.u32(r.finishTick < 0 ? 0xffffffff : r.finishTick);
    const c = r.crash;
    if (r.mode !== "riding" && c) {
      w.f32(c.bodyS);
      w.i16(c.bodyD * 100);
      w.i16(c.bodyH * 100);
      w.i16(c.bodyVs * 100);
      w.i16(c.bodyVd * 100);
      w.i16(c.bodyVh * 100);
      w.i16(c.bodySpin * 100);
      w.f32(c.bodyRot);
      w.f32(c.bikeS);
      w.i16(c.bikeD * 100);
      w.i16(c.bikeVs * 100);
      w.i16(c.bikeVd * 100);
      w.f32(c.bikeRot);
      w.i16(c.bikeSpin * 100);
      w.u16(c.t);
      w.u16(c.rest);
    }
  }
  w.u8(Math.min(255, s.events.length));
  for (const e of s.events.slice(0, 255)) {
    w.u8(EVENTS.indexOf(e.type));
    switch (e.type) {
      case "start":
        break;
      case "hit":
        w.u8(e.attacker);
        w.u8(e.target);
        w.u8(e.attack);
        w.i8(e.side);
        break;
      case "crash":
        w.u8(e.rider);
        w.u8(CAUSES.indexOf(e.cause));
        w.u8(e.by ?? 255);
        break;
      case "remount":
        w.u8(e.rider);
        break;
      case "bump":
        w.u8(e.a);
        w.u8(e.b);
        w.u8(e.strength * 100);
        break;
      case "finish":
        w.u8(e.rider);
        w.u8(e.place);
        break;
    }
  }
  return w.done();
}

export function decodeSnapshot(data: Uint8Array): Snapshot {
  const r = new Reader(data);
  r.u8();
  const tick = r.u32();
  const phase = PHASES[r.u8()];
  const countdown = r.u16();
  const ackSeq = r.u32();
  const n = r.u8();
  const riders: RiderNetState[] = [];
  for (let i = 0; i < n; i++) {
    const s = r.f32();
    const d = r.i16() / 100;
    const speed = r.u16() / 100;
    const vd = r.i16() / 100;
    const lean = r.i8() / 100;
    const rpm = r.u8() / 255;
    const gear = r.u8();
    const health = r.u8() / 2;
    const bikeDamage = r.u8() / 2;
    const flags = r.u8();
    const mode = MODES[flags & 7];
    const attack = r.u8() as Attack;
    const attackSide = (r.i8() < 0 ? -1 : 1) as -1 | 1;
    const attackT = r.u8();
    const attackCooldown = r.u8();
    const stagger = r.u8();
    const staggerSide = r.i8();
    const invulnerable = r.u8();
    const grudge = r.i8();
    const place = r.u8();
    const ft = r.u32();
    let crash: CrashState | null = null;
    if (mode !== "riding") {
      crash = {
        bodyS: r.f32(),
        bodyD: r.i16() / 100,
        bodyH: r.i16() / 100,
        bodyVs: r.i16() / 100,
        bodyVd: r.i16() / 100,
        bodyVh: r.i16() / 100,
        bodySpin: r.i16() / 100,
        bodyRot: r.f32(),
        bikeS: r.f32(),
        bikeD: r.i16() / 100,
        bikeVs: r.i16() / 100,
        bikeVd: r.i16() / 100,
        bikeRot: r.f32(),
        bikeSpin: r.i16() / 100,
        t: r.u16(),
        rest: r.u16(),
      };
    }
    riders.push({
      s,
      d,
      speed,
      vd,
      lean,
      rpm,
      gear,
      health,
      bikeDamage,
      mode,
      attack,
      attackSide,
      attackT,
      attackHit: (flags & 16) !== 0,
      attackCooldown,
      stagger,
      staggerSide,
      invulnerable,
      grudge,
      finished: (flags & 8) !== 0,
      finishTick: ft === 0xffffffff ? -1 : ft,
      place,
      human: (flags & 32) !== 0,
      crash,
    });
  }
  const events: SimEvent[] = [];
  const ne = r.u8();
  for (let i = 0; i < ne; i++) {
    const type = EVENTS[r.u8()];
    switch (type) {
      case "start":
        events.push({ type });
        break;
      case "hit":
        events.push({ type, attacker: r.u8(), target: r.u8(), attack: r.u8() as Attack, side: r.i8() });
        break;
      case "crash": {
        const rider = r.u8();
        const cause = CAUSES[r.u8()];
        const by = r.u8();
        events.push({ type, rider, cause, by: by === 255 ? undefined : by });
        break;
      }
      case "remount":
        events.push({ type, rider: r.u8() });
        break;
      case "bump":
        events.push({ type, a: r.u8(), b: r.u8(), strength: r.u8() / 100 });
        break;
      case "finish":
        events.push({ type, rider: r.u8(), place: r.u8() });
        break;
    }
  }
  return { tick, phase, countdown, ackSeq, riders, events };
}

/** Copies networked fields onto a live RiderState. */
export function applyNetState(dst: RiderState, src: RiderNetState): void {
  dst.s = src.s;
  dst.d = src.d;
  dst.speed = src.speed;
  dst.vd = src.vd;
  dst.lean = src.lean;
  dst.rpm = src.rpm;
  dst.gear = src.gear;
  dst.health = src.health;
  dst.bikeDamage = src.bikeDamage;
  dst.mode = src.mode;
  dst.attack = src.attack;
  dst.attackSide = src.attackSide;
  dst.attackT = src.attackT;
  dst.attackHit = src.attackHit;
  dst.attackCooldown = src.attackCooldown;
  dst.stagger = src.stagger;
  dst.staggerSide = src.staggerSide;
  dst.invulnerable = src.invulnerable;
  dst.grudge = src.grudge;
  dst.finished = src.finished;
  dst.finishTick = src.finishTick;
  dst.place = src.place;
  dst.human = src.human;
  dst.crash = src.crash ? { ...src.crash } : null;
}

export function riderNetState(r: RiderState): RiderNetState {
  return {
    s: r.s,
    d: r.d,
    speed: r.speed,
    vd: r.vd,
    lean: r.lean,
    rpm: r.rpm,
    gear: r.gear,
    health: r.health,
    bikeDamage: r.bikeDamage,
    mode: r.mode,
    attack: r.attack,
    attackSide: r.attackSide,
    attackT: r.attackT,
    attackHit: r.attackHit,
    attackCooldown: r.attackCooldown,
    stagger: r.stagger,
    staggerSide: r.staggerSide,
    invulnerable: r.invulnerable,
    grudge: r.grudge,
    finished: r.finished,
    finishTick: r.finishTick,
    place: r.place,
    human: r.human,
    crash: r.crash,
  };
}
