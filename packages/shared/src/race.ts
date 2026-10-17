import { think } from "./ai.ts";
import { COUNTDOWN_TICKS, DT, TICK_RATE } from "./constants.ts";
import { collideRiders, stepCrashing, stepRiding, stepRunning, type SimContext, type SimEvent } from "./physics.ts";
import { BIKES, createRider, idleInput, type Personality, type RiderInput, type RiderState } from "./rider.ts";
import { Rng } from "./rng.ts";
import { generateProps, type Prop } from "./scenery.ts";
import { generateTrack, type Track } from "./track.ts";
import { generateTraffic, stepTraffic, type Car } from "./traffic.ts";

export type RacePhase = "countdown" | "racing" | "finished";

export interface RacerEntry {
  name: string;
  colour: number;
  human: boolean;
  bike?: keyof typeof BIKES;
  personality?: Personality;
}


export const RIVALS: { name: string; colour: number; personality: Personality }[] = [
  { name: "Viper", colour: 0x2fbf71, personality: { skill: 0.97, aggression: 0.8, line: -1.5 } },
  { name: "Slab", colour: 0x8f5bd6, personality: { skill: 0.9, aggression: 0.95, line: 1 } },
  { name: "Moxie", colour: 0xf2c14e, personality: { skill: 0.98, aggression: 0.35, line: 2.5 } },
  { name: "Rook", colour: 0x4aa3df, personality: { skill: 0.93, aggression: 0.55, line: -3 } },
  { name: "Dutch", colour: 0xe0663a, personality: { skill: 0.91, aggression: 0.7, line: 0 } },
  { name: "Nails", colour: 0xc0c0c8, personality: { skill: 0.95, aggression: 0.9, line: 3.5 } },
  { name: "Juno", colour: 0xe85d9c, personality: { skill: 0.96, aggression: 0.2, line: -2 } },
  { name: "Grit", colour: 0x9a7b4f, personality: { skill: 0.88, aggression: 0.6, line: 1.8 } },
  { name: "Lark", colour: 0x58c4c4, personality: { skill: 0.94, aggression: 0.4, line: -0.5 } },
  { name: "Brick", colour: 0xb33a3a, personality: { skill: 0.89, aggression: 1.0, line: 2.2 } },
  { name: "Echo", colour: 0x7fb24a, personality: { skill: 0.92, aggression: 0.3, line: -3.5 } },
];

/** The whole deterministic simulation for one race. Same seed + same inputs → same result. */
export class Race implements SimContext {
  readonly track: Track;
  readonly props: Prop[];
  readonly cars: Car[];
  readonly riders: RiderState[];
  readonly rng: Rng;
  events: SimEvent[] = [];
  tick = 0;
  phase: RacePhase = "countdown";
  countdown = COUNTDOWN_TICKS;
  private finishers = 0;
  private aiInput = idleInput();

  constructor(seed: number, entries: RacerEntry[]) {
    this.track = generateTrack(seed);
    this.props = generateProps(this.track);
    this.cars = generateTraffic(this.track);
    this.rng = new Rng(seed ^ 0x5bd1e995);
    const neutral: Personality = { skill: 0.95, aggression: 0.5, line: 0 };
    this.riders = entries.map((e, i) =>
      createRider(i, e.name, e.colour, e.human, BIKES[e.bike ?? "diablo"], e.personality ?? neutral),
    );
    // Grid: rows of four, staggered.
    const cols = [-4.5, -1.5, 1.5, 4.5];
    this.riders.forEach((r, i) => {
      const row = Math.floor(i / 4);
      r.s = this.track.startLine - row * 7 - (i % 2) * 1.5;
      r.d = cols[i % 4];
    });
  }

  /** Advances one fixed tick. `inputs` holds input for human riders by id. */
  step(inputs: ReadonlyMap<number, RiderInput>): SimEvent[] {
    this.events = [];
    this.tick++;
    stepTraffic(this.cars, this.track, DT);

    if (this.phase === "countdown") {
      // Riders can rev on the line but not move.
      for (const r of this.riders) {
        const inp = r.human ? inputs.get(r.id) : undefined;
        const target = r.human ? (inp?.throttle ?? 0) : 0.3 + 0.3 * Math.sin(this.tick * 0.07 + r.id);
        r.rpm += (0.15 + target * 0.8 - r.rpm) * 0.12;
      }
      if (--this.countdown <= 0) {
        this.phase = "racing";
        this.events.push({ type: "start" });
      }
      return this.events;
    }

    for (const r of this.riders) {
      switch (r.mode) {
        case "riding": {
          const inp = r.human && !r.finished ? (inputs.get(r.id) ?? idleInput()) : think(r, this, this.aiInput);
          stepRiding(r, inp, this);
          break;
        }
        case "crashing":
          stepCrashing(r, this);
          break;
        case "running":
          stepRunning(r, this);
          break;
      }
      if (!r.finished && r.s >= this.track.finishLine) {
        r.finished = true;
        r.finishTick = this.tick;
        r.place = ++this.finishers;
        this.events.push({ type: "finish", rider: r.id, place: r.place });
      }
    }
    collideRiders(this);
    this.updatePlaces();

    const hasHumans = this.riders.some((r) => r.human);
    if (this.phase === "racing" && this.riders.every((r) => r.finished || (hasHumans && !r.human))) this.phase = "finished";
    return this.events;
  }

  /** Race time in seconds since the start. */
  get time(): number {
    return Math.max(0, this.tick - COUNTDOWN_TICKS) * DT;
  }

  private updatePlaces(): void {
    const racing = this.riders.filter((r) => !r.finished).sort((a, b) => b.s - a.s);
    racing.forEach((r, i) => (r.place = this.finishers + i + 1));
  }
}
