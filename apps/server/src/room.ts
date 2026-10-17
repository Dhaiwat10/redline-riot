import {
  COUNTDOWN_TICKS,
  DT,
  MAX_HUMANS,
  RACE_SIZE,
  RIVALS,
  Race,
  SNAPSHOT_EVERY,
  TICK_RATE,
  TRACK_SEED,
  encodeSnapshot,
  idleInput,
  riderNetState,
  type InputFrame,
  type RacerEntry,
  type RiderInput,
  type RiderState,
  type RoomInfo,
  type RoomState,
  type SimEvent,
} from "@rr/shared";
import type { Conn } from "./conn.ts";

export interface Player {
  id: number;
  name: string;
  colour: number;
  conn: Conn;
  room: Room | null;
  riderId: number;
  inputs: InputFrame[];
  last: RiderInput;
  ackSeq: number;
  viewTick: number;
  connected: boolean;
}

/** Seconds a public lobby waits for more riders before starting with AI. */
export const PUBLIC_WAIT_S = 20;
/** Once someone finishes, stragglers get this long. */
const FINISH_GRACE_S = 30;
const RESULTS_S = 10;
const MAX_RACE_S = 7 * 60;
/** Hit checks rewind at most this far, so high ping can't land impossible hits. */
const MAX_REWIND_TICKS = 9;
const HISTORY = 32;

const PLAYER_COLOURS = [0xe8402a, 0x3a86ff, 0xffbe0b, 0x8338ec, 0x06d6a0, 0xff006e, 0xfb5607, 0xf1f1f1];

export class Room {
  readonly players: Player[] = [];
  state: RoomState = "lobby";
  hostId = -1;
  startsAt: number | null = null;
  race: Race | null = null;

  private loop: ReturnType<typeof setTimeout> | null = null;
  private acc = 0;
  private lastTime = 0;
  private pendingEvents: SimEvent[] = [];
  private firstFinishTick = -1;
  private history: { s: Float64Array; d: Float64Array }[] = [];
  private lobbyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly code: string,
    readonly isPublic: boolean,
    private readonly onEmpty: (room: Room) => void,
  ) {}

  get humans() {
    return this.players.filter((p) => p.connected).length;
  }

  get joinable() {
    return this.state === "lobby" && this.humans < MAX_HUMANS;
  }

  info(): RoomInfo {
    return {
      code: this.code,
      public: this.isPublic,
      hostId: this.hostId,
      state: this.state,
      startsAt: this.startsAt,
      players: this.players.map((p) => ({ id: p.id, name: p.name, colour: p.colour, ready: true, connected: p.connected })),
    };
  }

  broadcastRoom(): void {
    const room = this.info();
    for (const p of this.players) if (p.connected) p.conn.send({ t: "room", room });
  }

  add(p: Player): void {
    p.room = this;
    p.connected = true;
    // Avoid two riders in the same colour.
    const used = new Set(this.players.map((o) => o.colour));
    if (used.has(p.colour)) p.colour = PLAYER_COLOURS.find((c) => !used.has(c)) ?? p.colour;
    this.players.push(p);
    if (this.hostId < 0) this.hostId = p.id;
    if (this.isPublic) this.scheduleAutoStart();
    this.broadcastRoom();
  }

  remove(p: Player): void {
    p.room = null;
    if (this.state === "racing" && this.race && p.riderId >= 0) {
      // Keep the bike in the race; the AI takes over.
      const r = this.race.riders[p.riderId];
      r.human = false;
      r.name = `${r.name} (AI)`;
    }
    const i = this.players.indexOf(p);
    if (i >= 0) this.players.splice(i, 1);
    if (this.players.length === 0) {
      this.destroy();
      return;
    }
    if (this.hostId === p.id) this.hostId = this.players[0].id;
    if (this.isPublic && this.state === "lobby") this.scheduleAutoStart();
    this.broadcastRoom();
  }

  private scheduleAutoStart(): void {
    if (this.state !== "lobby") return;
    const now = Date.now();
    if (this.startsAt === null) this.startsAt = now + PUBLIC_WAIT_S * 1000;
    if (this.humans >= MAX_HUMANS) this.startsAt = Math.min(this.startsAt, now + 3000);
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    this.lobbyTimer = setTimeout(() => this.start(), Math.max(0, this.startsAt - now));
  }

  requestStart(p: Player): void {
    if (this.state !== "lobby") return;
    if (!this.isPublic && p.id !== this.hostId) return;
    this.start();
  }

  start(): void {
    if (this.state !== "lobby" || this.players.length === 0) return;
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    this.lobbyTimer = null;
    this.startsAt = null;

    // Humans start mid-grid, AI fills the rest.
    const humans: RacerEntry[] = this.players.map((p) => ({ name: p.name, colour: p.colour, human: true }));
    const ai: RacerEntry[] = RIVALS.slice(0, Math.max(0, RACE_SIZE - humans.length)).map((r) => ({ ...r, human: false }));
    const front = Math.floor(ai.length / 2);
    const entries = [...ai.slice(0, front), ...humans, ...ai.slice(front)];
    this.race = new Race(TRACK_SEED, entries);
    this.players.forEach((p, i) => {
      p.riderId = front + i;
      p.inputs = [];
      p.last = idleInput();
      p.ackSeq = 0;
      p.viewTick = 0;
    });
    this.history = this.race.riders.map(() => ({ s: new Float64Array(HISTORY), d: new Float64Array(HISTORY) }));
    this.race.rewind = (attacker, target) => this.rewind(attacker, target);
    this.firstFinishTick = -1;
    this.pendingEvents = [];
    this.state = "racing";
    for (const p of this.players) p.conn.send({ t: "start", seed: TRACK_SEED, entries, riderId: p.riderId, tick: 0 });
    this.broadcastRoom();
    this.lastTime = performance.now();
    this.acc = 0;
    this.tickLoop();
  }

  receiveInput(p: Player, f: InputFrame): void {
    if (this.state !== "racing" || f.seq <= p.ackSeq) return;
    p.inputs.push(f);
    // A client whose clock runs fast builds a queue, which is just added latency. Trim it,
    // but never drop a button press.
    while (p.inputs.length > 4) {
      const dropped = p.inputs.shift()!;
      if (dropped.input.attack && !p.inputs[0].input.attack) {
        p.inputs[0].input.attack = dropped.input.attack;
        p.inputs[0].input.attackSide = dropped.input.attackSide;
      }
      p.ackSeq = dropped.seq;
    }
  }

  private rewind(attacker: RiderState, target: RiderState): { s: number; d: number } | null {
    const p = this.players.find((pl) => pl.riderId === attacker.id && pl.connected);
    if (!p || !this.race) return null;
    const back = Math.max(0, Math.min(MAX_REWIND_TICKS, this.race.tick - p.viewTick));
    if (back === 0) return null;
    const h = this.history[target.id];
    const k = (this.race.tick - back) % HISTORY;
    return { s: h.s[k], d: h.d[k] };
  }

  private tickLoop(): void {
    const now = performance.now();
    this.acc += Math.min(0.25, (now - this.lastTime) / 1000);
    this.lastTime = now;
    try {
      while (this.acc >= DT && this.state === "racing") {
        this.acc -= DT;
        this.step();
      }
    } catch (e) {
      // A bug in one race must not take down every other room on the server.
      console.error(`room ${this.code} crashed, ending race:`, e);
      this.finish();
      return;
    }
    if (this.state === "racing") this.loop = setTimeout(() => this.tickLoop(), 4);
  }

  private step(): void {
    const race = this.race!;
    const inputs = new Map<number, RiderInput>();
    for (const p of this.players) {
      if (!p.connected) continue;
      const f = p.inputs.shift();
      if (f) {
        p.last = f.input;
        p.ackSeq = f.seq;
        p.viewTick = f.viewTick;
        inputs.set(p.riderId, f.input);
      } else {
        // No input arrived in time: repeat the last one, minus any button press.
        inputs.set(p.riderId, { ...p.last, attack: 0 });
      }
    }
    const events = race.step(inputs);
    this.pendingEvents.push(...events);
    const k = race.tick % HISTORY;
    race.riders.forEach((r, i) => {
      this.history[i].s[k] = r.s;
      this.history[i].d[k] = r.d;
    });

    if (this.firstFinishTick < 0 && race.riders.some((r) => r.human && r.finished)) this.firstFinishTick = race.tick;
    const time = (race.tick - COUNTDOWN_TICKS) / TICK_RATE;
    const graceOver = this.firstFinishTick >= 0 && race.tick - this.firstFinishTick > FINISH_GRACE_S * TICK_RATE;
    const allDone = race.riders.every((r) => !r.human || r.finished);
    const over = allDone || graceOver || time > MAX_RACE_S;

    if (race.tick % SNAPSHOT_EVERY === 0 || over) this.sendSnapshots();
    if (over) this.finish();
  }

  private sendSnapshots(): void {
    const race = this.race!;
    const riders = race.riders.map(riderNetState);
    for (const p of this.players) {
      if (!p.connected) continue;
      p.conn.sendBinary(
        encodeSnapshot({ tick: race.tick, phase: race.phase, countdown: race.countdown, ackSeq: p.ackSeq, riders, events: this.pendingEvents }),
      );
    }
    this.pendingEvents = [];
  }

  private finish(): void {
    if (this.loop) clearTimeout(this.loop);
    this.loop = null;
    this.state = "results";
    this.broadcastRoom();
    this.lobbyTimer = setTimeout(() => {
      this.state = "lobby";
      this.race = null;
      if (this.isPublic) this.scheduleAutoStart();
      this.broadcastRoom();
    }, RESULTS_S * 1000);
  }

  destroy(): void {
    if (this.loop) clearTimeout(this.loop);
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    this.loop = null;
    this.lobbyTimer = null;
    this.state = "lobby";
    this.onEmpty(this);
  }
}
