import * as THREE from "three";
import { newFrame, valueNoise2, type RiderState, type Track } from "@rr/shared";
import type { RiderSnap } from "./riderView.ts";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Chase camera that rides along the track frame so it swings naturally through bends. */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private camS = 0;
  private camD = 0;
  private camH = 2.4;
  private roll = 0;
  private trauma = 0;
  private readonly f = newFrame();
  private readonly look = new THREE.Vector3();
  private readonly lookSmoothed = new THREE.Vector3();
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 5000);
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(r: RiderState, prev: RiderSnap, cur: RiderSnap, alpha: number, track: Track, dt: number, time: number): void {
    const crashed = r.mode !== "riding";
    const s = lerp(crashed ? prev.bodyS : prev.s, crashed ? cur.bodyS : cur.s, alpha);
    const d = lerp(crashed ? prev.bodyD : prev.d, crashed ? cur.bodyD : cur.d, alpha);
    const lean = lerp(prev.lean, cur.lean, alpha);
    const speed = r.speed;

    // Tall (portrait) screens: sit higher and further back so the extra height shows road ahead.
    const portrait = this.camera.aspect < 0.85;
    const dist = (crashed ? 8 : 3.9 + speed * 0.022) + (portrait ? 1.6 : 0);
    const height = (crashed ? 3.5 : 1.75 + speed * 0.004) + (portrait ? 1.1 : 0);
    const targetS = s - dist;
    const k = 1 - Math.exp(-dt * (crashed ? 2.5 : 9));
    if (!this.initialised) {
      this.camS = targetS;
      this.camD = d;
      this.initialised = true;
    }
    this.camS = lerp(this.camS, targetS, k);
    this.camD = lerp(this.camD, d * 0.88, 1 - Math.exp(-dt * 6));
    this.camH = lerp(this.camH, height, 1 - Math.exp(-dt * 3));

    const f = this.f;
    track.frame(this.camS, f);
    const cam = this.camera;
    const roadAtCam = f.y;
    cam.position.set(f.x + f.rx * this.camD, 0, f.z + f.rz * this.camD);
    // Keep above both the road at the camera and the rider (crests and dips).
    const riderY = track.heightAt(s);
    cam.position.y = Math.max(roadAtCam, riderY - 0.5) + this.camH;

    track.frame(s + (crashed ? 0 : 9 + speed * 0.08), f);
    this.look.set(f.x + f.rx * d, f.y + (crashed ? 0.4 : 1.45) + (portrait && !crashed ? 0.9 : 0), f.z + f.rz * d);
    if (this.lookSmoothed.lengthSq() === 0) this.lookSmoothed.copy(this.look);
    this.lookSmoothed.lerp(this.look, 1 - Math.exp(-dt * 14));
    cam.lookAt(this.lookSmoothed);

    // Bank slightly with the bike, and shake on impacts / rough ground.
    this.roll = lerp(this.roll, crashed ? 0 : -lean * 0.22, 1 - Math.exp(-dt * 5));
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const sh = this.trauma * this.trauma;
    const offroad = !crashed && Math.abs(r.d) > 9.5 ? Math.min(1, speed / 20) * 0.25 : 0;
    const amp = sh + offroad * 0.3;
    cam.rotateZ(this.roll + valueNoise2(time * 25, 3) * 0.05 * amp);
    cam.rotateX(valueNoise2(time * 25, 7) * 0.04 * amp);
    cam.rotateY(valueNoise2(time * 25, 11) * 0.04 * amp);

    // Widen the lens with speed.
    const fov = fitFov(60 + Math.min(1, speed / 65) * 16, cam.aspect);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = lerp(cam.fov, fov, 1 - Math.exp(-dt * 3));
      cam.updateProjectionMatrix();
    }
  }
}

/**
 * Three.js FOV is vertical, so a narrow portrait screen would see a sliver of road. Widen the
 * vertical FOV part of the way toward keeping the horizontal view constant.
 */
export function fitFov(fov: number, aspect: number): number {
  if (aspect >= 1) return fov;
  const half = (fov * Math.PI) / 360;
  const widened = 2 * Math.atan(Math.tan(half) / Math.sqrt(aspect));
  return Math.min(100, (widened * 180) / Math.PI);
}
