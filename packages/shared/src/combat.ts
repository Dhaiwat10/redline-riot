import { Attack } from "./rider.ts";

export interface AttackSpec {
  windup: number; // ticks before the hit can land
  active: number; // ticks the hit can land
  recovery: number; // ticks after, before another attack
  reach: number; // max lateral gap, metres
  minReach: number;
  window: number; // max gap along the road, metres
  damage: number;
  knock: number; // lateral shove, m/s
}

export const ATTACKS: Record<Attack.Punch | Attack.Kick, AttackSpec> = {
  [Attack.Punch]: { windup: 7, active: 6, recovery: 11, reach: 1.75, minReach: 0.25, window: 2.2, damage: 10, knock: 2.6 },
  [Attack.Kick]: { windup: 13, active: 6, recovery: 16, reach: 2.2, minReach: 0.6, window: 2.4, damage: 17, knock: 4.2 },
};

export const attackSpec = (a: Attack): AttackSpec | null => (a === Attack.None ? null : ATTACKS[a as Attack.Punch | Attack.Kick]);

export const attackDuration = (a: Attack): number => {
  const sp = attackSpec(a);
  return sp ? sp.windup + sp.active + sp.recovery : 0;
};
