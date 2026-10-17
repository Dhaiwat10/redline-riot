import * as THREE from "three";
import { Attack, attackSpec, newFrame, type RiderState, type Track } from "@rr/shared";
import { solveTwoBone } from "./ik.ts";
import { WHEEL_R, createBike, createRider, type BikeRig, type RiderRig } from "./models.ts";

/** Everything the renderer interpolates between two sim ticks. */
export interface RiderSnap {
  s: number;
  d: number;
  lean: number;
  bodyS: number;
  bodyD: number;
  bodyH: number;
  bodyRot: number;
  bikeS: number;
  bikeD: number;
  bikeRot: number;
}

export function snapRider(r: RiderState, out: RiderSnap): RiderSnap {
  out.s = r.s;
  out.d = r.d;
  out.lean = r.lean;
  const c = r.crash;
  out.bodyS = c ? c.bodyS : r.s;
  out.bodyD = c ? c.bodyD : r.d;
  out.bodyH = c ? c.bodyH : 0;
  out.bodyRot = c ? c.bodyRot : 0;
  out.bikeS = c ? c.bikeS : r.s;
  out.bikeD = c ? c.bikeD : r.d;
  out.bikeRot = c ? c.bikeRot : 0;
  return out;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const frame = newFrame();
const ARM_U = 0.3;
const ARM_L = 0.29 + 0.1;
const LEG_U = 0.44;
const LEG_L = 0.46 + 0.08;

// Fixed points in the rider's hip space (seat origin, +z forward, -x = right).
const SHOULDER_T = [new THREE.Vector3(0.24, 0.52, 0), new THREE.Vector3(-0.24, 0.52, 0)];
const HIP_P = [new THREE.Vector3(0.13, 0, 0), new THREE.Vector3(-0.13, 0, 0)];
const GRIP = [new THREE.Vector3(0.33, 0.12, 0.74), new THREE.Vector3(-0.33, 0.12, 0.74)];
const PEG = [new THREE.Vector3(0.24, -0.5, 0.2), new THREE.Vector3(-0.24, -0.5, 0.2)];

const _t = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

export class RiderView {
  readonly bike: BikeRig;
  readonly rig: RiderRig;
  private onBike = true;
  private wheelSpin = 0;
  private runPhase = 0;
  private settle = 0;

  constructor(
    readonly state: RiderState,
    private readonly scene: THREE.Scene,
  ) {
    this.bike = createBike(state.colour);
    this.rig = createRider(state.colour);
    scene.add(this.bike.root);
    this.bike.seat.add(this.rig.root);
    this.bike.root.rotation.order = "YXZ";
    this.rig.root.rotation.order = "YXZ";
  }

  /** World position of an (s, d) point plus height above the road. */
  static place(track: Track, s: number, d: number, h: number, out: THREE.Vector3): THREE.Vector3 {
    track.frame(s, frame);
    return out.set(frame.x + frame.rx * d, frame.y + h, frame.z + frame.rz * d);
  }

  update(prev: RiderSnap, cur: RiderSnap, alpha: number, dt: number, track: Track, time: number): void {
    const r = this.state;
    const bike = this.bike;
    const crashed = r.mode !== "riding";

    if (!crashed) {
      if (!this.onBike) {
        this.bike.seat.add(this.rig.root);
        this.rig.root.position.set(0, 0, 0);
        this.rig.root.rotation.set(0, 0, 0);
        this.onBike = true;
      }
      const s = lerp(prev.s, cur.s, alpha);
      const d = lerp(prev.d, cur.d, alpha);
      track.frame(s, frame);
      bike.root.position.set(frame.x + frame.rx * d, frame.y, frame.z + frame.rz * d);
      const dDot = (cur.d - prev.d) * 60;
      bike.root.rotation.set(-Math.atan(frame.slope), frame.heading - Math.atan2(dDot, Math.max(r.speed, 4)) * 0.8, 0);
      bike.lean.rotation.z = lerp(prev.lean, cur.lean, alpha);
      this.wheelSpin += (r.speed / WHEEL_R) * dt;
      this.poseRiding(time);
    } else {
      if (this.onBike) {
        this.scene.add(this.rig.root);
        this.onBike = false;
        this.settle = 0;
      }
      const c = r.crash!;
      // Bike on its side, sliding and spinning.
      const bs = lerp(prev.bikeS, cur.bikeS, alpha);
      const bd = lerp(prev.bikeD, cur.bikeD, alpha);
      track.frame(bs, frame);
      bike.root.position.set(frame.x + frame.rx * bd, frame.y + 0.05, frame.z + frame.rz * bd);
      bike.root.rotation.set(0, frame.heading + lerp(prev.bikeRot, cur.bikeRot, alpha), 0);
      bike.lean.rotation.z = THREE.MathUtils.lerp(bike.lean.rotation.z, 1.35, Math.min(1, dt * 10));
      this.wheelSpin += Math.abs(c.bikeVs) * 2 * dt;

      const s = lerp(prev.bodyS, cur.bodyS, alpha);
      const d = lerp(prev.bodyD, cur.bodyD, alpha);
      const h = lerp(prev.bodyH, cur.bodyH, alpha);
      track.frame(s, frame);
      const root = this.rig.root;
      if (r.mode === "crashing") {
        root.position.set(frame.x + frame.rx * d, frame.y + h + 0.25, frame.z + frame.rz * d);
        let rot = lerp(prev.bodyRot, cur.bodyRot, alpha);
        if (c.bodyH <= 0.01 && Math.abs(c.bodySpin) < 2.5) {
          // Settle into lying flat.
          this.settle = Math.min(1, this.settle + dt * 3);
          const flat = Math.round((rot - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
          rot = lerp(rot, flat, this.settle);
          root.position.y -= 0.1 * this.settle;
        }
        root.rotation.set(rot, frame.heading, Math.sin(rot * 0.7) * 0.4);
        this.poseTumble(time, c.t);
      } else {
        // Running back to the bike.
        root.position.set(frame.x + frame.rx * d, frame.y + 0.98, frame.z + frame.rz * d);
        const dx = bike.root.position.x - root.position.x;
        const dz = bike.root.position.z - root.position.z;
        root.rotation.set(0, Math.atan2(dx, dz), 0);
        this.runPhase += dt * 11;
        this.poseRunning();
      }
    }
    bike.front.rotation.x = this.wheelSpin;
    bike.rear.rotation.x = this.wheelSpin;
  }

  private poseRiding(time: number): void {
    const r = this.state;
    const rig = this.rig;
    const tuck = Math.min(1, r.speed / 40);
    rig.torso.rotation.set(0.62 + tuck * 0.2, 0, 0);
    if (r.stagger > 0) rig.torso.rotation.z = r.staggerSide * -0.35 * (r.stagger / 18);
    rig.head.rotation.set(-0.45 - tuck * 0.2, 0, 0);
    rig.root.position.y = Math.sin(time * 9 + r.id) * 0.008 * Math.min(1, r.speed / 10);

    // Attack progress: 0 none, windup 0..1, strike, recovery.
    const spec = attackSpec(r.attack);
    let side = -1;
    let windup = 0;
    let strike = 0;
    if (spec) {
      side = r.attackSide > 0 ? 1 : 0; // index: 1 = right arm/leg
      const t = r.attackT;
      if (t <= spec.windup) windup = t / spec.windup;
      else if (t <= spec.windup + spec.active) strike = 1;
      else strike = 1 - (t - spec.windup - spec.active) / spec.recovery;
      // Head turns to look at the target side.
      rig.head.rotation.y = (r.attackSide > 0 ? -0.6 : 0.6) * Math.max(windup, strike);
    } else rig.head.rotation.y = 0;
    const isKick = r.attack === Attack.Kick;

    // Arms: IK in torso space. Convert hip-space grips into torso space.
    _m.makeRotationFromEuler(rig.torso.rotation).invert();
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? 1 : -1;
      _t.copy(GRIP[i]).applyMatrix4(_m);
      if (!isKick && side === i) {
        const sh = SHOULDER_T[i];
        // Wind back and up, then fling straight out to the side.
        const back = _pole.set(sh.x + sign * 0.12, sh.y + 0.18, sh.z - 0.28);
        _t.lerp(back, windup);
        const out = new THREE.Vector3(sh.x + sign * 0.62, sh.y + 0.02, sh.z + 0.12);
        if (strike > 0) _t.lerp(out, strike);
      }
      _pole.set(sign * 1, -0.6, -0.2);
      solveTwoBone(rig.shoulders[i], rig.elbows[i], SHOULDER_T[i], _t, _pole, ARM_U, ARM_L);
    }
    // Legs: IK in hip space.
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? 1 : -1;
      _t.copy(PEG[i]);
      if (isKick && side === i) {
        const tuckIn = _pole.set(HIP_P[i].x + sign * 0.1, -0.15, 0.35);
        _t.lerp(tuckIn, windup);
        if (strike > 0) _t.lerp(new THREE.Vector3(HIP_P[i].x + sign * 0.95, -0.3, 0.05), strike);
      }
      _pole.set(sign * 0.2, 0.4, 1);
      solveTwoBone(rig.hips[i], rig.knees[i], HIP_P[i], _t, _pole, LEG_U, LEG_L);
    }
  }

  private poseTumble(time: number, t: number): void {
    const rig = this.rig;
    const flail = Math.max(0, 1 - this.settle);
    rig.torso.rotation.set(0.2 * flail, 0, 0);
    rig.head.rotation.set(0, 0, 0);
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? 1 : -1;
      const w = Math.sin(time * 14 + i * 2) * flail;
      _t.set(sign * (0.7 + 0.15 * w), 0.55 + 0.4 * flail + 0.2 * w, 0.1 * w);
      _pole.set(0, 0, -1);
      solveTwoBone(rig.shoulders[i], rig.elbows[i], SHOULDER_T[i], _t, _pole, ARM_U, ARM_L);
      _t.set(sign * (0.35 + 0.15 * flail), -0.85, 0.2 * Math.cos(time * 12 + i) * flail);
      _pole.set(0, 0, 1);
      solveTwoBone(rig.hips[i], rig.knees[i], HIP_P[i], _t, _pole, LEG_U, LEG_L);
    }
    void t;
  }

  private poseRunning(): void {
    const rig = this.rig;
    const p = this.runPhase;
    rig.torso.rotation.set(0.25, 0, 0);
    rig.head.rotation.set(-0.15, 0, 0);
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? 1 : -1;
      const sw = Math.sin(p + i * Math.PI);
      _t.set(sign * 0.3, 0.12, -sw * 0.32);
      _pole.set(0, 0, -1);
      solveTwoBone(rig.shoulders[i], rig.elbows[i], SHOULDER_T[i], _t, _pole, ARM_U, ARM_L);
      const lift = Math.max(0, Math.cos(p + i * Math.PI)) * 0.25;
      _t.set(sign * 0.14, -0.92 + lift, sw * 0.42);
      _pole.set(0, 0, 1);
      solveTwoBone(rig.hips[i], rig.knees[i], HIP_P[i], _t, _pole, LEG_U, LEG_L);
    }
  }

  dispose(): void {
    this.scene.remove(this.bike.root, this.rig.root);
  }
}
void _q;
