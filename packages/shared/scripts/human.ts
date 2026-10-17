// A scripted "human" that holds full throttle and steers to the lane centre: how does it place?
import { Race, RIVALS, idleInput, newFrame, DRIFT_K } from "../src/index.ts";
const rivals = RIVALS.map((r) => ({ ...r, human: false }));
const race = new Race(20261017, [...rivals.slice(0, 6), { name: "You", colour: 0, human: true }, ...rivals.slice(6)]);
const me = race.riders[6];
const inp = idleInput();
const f = newFrame();
const inputs = new Map([[me.id, inp]]);
for (let i = 0; i < 60 * 200 && !me.finished; i++) {
  race.track.frame(me.s, f);
  inp.throttle = 1;
  inp.steer = Math.max(-1, Math.min(1, ((2.5 - me.d) * 2 - me.vd * 0.3 + f.curve * me.speed ** 2 * DRIFT_K) / 9));
  race.step(inputs);
  if ([600, 1200, 1800, 3600, 6000].includes(i)) console.log(`t=${(i / 60 - 3).toFixed(0)}s place ${me.place} speed ${me.speed.toFixed(0)} hp ${me.health.toFixed(0)} mode ${me.mode} leader gap ${(Math.max(...race.riders.map((r) => r.s)) - me.s).toFixed(0)}m`);
}
console.log("finish", me.place, (race.tick / 60 - 3).toFixed(1));
