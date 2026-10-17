export enum Attack {
  None = 0,
  Punch = 1,
  Kick = 2,
}

/** One tick of player intent. Small and flat so it is cheap to send over the network. */
export interface RiderInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. 1 (right)
  attack: Attack; // edge-triggered: only the tick the button went down
  attackSide: -1 | 1;
}

export const idleInput = (): RiderInput => ({ throttle: 0, brake: 0, steer: 0, attack: Attack.None, attackSide: 1 });

export type RiderMode = "riding" | "crashing" | "running";

export interface CrashState {
  /** Rider body, in track space plus height above the road. */
  bodyS: number;
  bodyD: number;
  bodyH: number;
  bodyVs: number;
  bodyVd: number;
  bodyVh: number;
  bodySpin: number;
  bodyRot: number;
  /** The bike sliding along on its side. */
  bikeS: number;
  bikeD: number;
  bikeVs: number;
  bikeVd: number;
  bikeRot: number;
  bikeSpin: number;
  /** Ticks since the crash started. */
  t: number;
  /** Ticks the body has been resting on the ground. */
  rest: number;
}

export interface BikeSpec {
  name: string;
  topSpeed: number; // m/s
  accel: number; // m/s² from standstill
  brake: number; // m/s²
  grip: number; // lateral authority multiplier
  mass: number; // relative, for bumps
}

export const BIKES: Record<string, BikeSpec> = {
  diablo: { name: "Diablo 750", topSpeed: 66, accel: 11.5, brake: 19, grip: 1, mass: 1 },
  rat: { name: "Ratter 400", topSpeed: 58, accel: 10, brake: 17, grip: 0.95, mass: 0.9 },
};

export interface Personality {
  /** Fraction of the bike's potential the AI uses. */
  skill: number;
  /** 0 = pacifist, 1 = starts fights. */
  aggression: number;
  /** Preferred lateral offset from the ideal line. */
  line: number;
}

export interface RiderState {
  id: number;
  name: string;
  colour: number;
  human: boolean;
  bike: BikeSpec;
  personality: Personality;

  s: number;
  d: number;
  speed: number;
  vd: number;
  lean: number;
  rpm: number; // 0..1 within the current gear
  gear: number;

  health: number; // 0..100, knocked off at 0
  bikeDamage: number; // 0..100

  mode: RiderMode;
  crash: CrashState | null;

  attack: Attack;
  attackSide: -1 | 1;
  attackT: number;
  attackHit: boolean;
  attackCooldown: number;

  stagger: number; // ticks of hit reaction remaining
  staggerSide: number;
  invulnerable: number; // ticks after remounting

  grudge: number; // id of the rider who last hit us, -1 if none
  /** AI-only top speed multiplier used for rubber-banding. */
  boost: number;
  finished: boolean;
  finishTick: number;
  place: number;
}

export function createRider(id: number, name: string, colour: number, human: boolean, bike: BikeSpec, personality: Personality): RiderState {
  return {
    id,
    name,
    colour,
    human,
    bike,
    personality,
    s: 0,
    d: 0,
    speed: 0,
    vd: 0,
    lean: 0,
    rpm: 0,
    gear: 1,
    health: 100,
    bikeDamage: 0,
    mode: "riding",
    crash: null,
    attack: Attack.None,
    attackSide: 1,
    attackT: 0,
    attackHit: false,
    attackCooldown: 0,
    stagger: 0,
    staggerSide: 0,
    invulnerable: 0,
    grudge: -1,
    boost: 1,
    finished: false,
    finishTick: -1,
    place: 0,
  };
}
