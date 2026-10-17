import * as THREE from "three";
import { newFrame, type Car, type Track } from "@rr/shared";
import { createCar } from "./models.ts";

const VIEW_RANGE = 700;

export class TrafficView {
  private readonly views: THREE.Group[] = [];
  private readonly scene: THREE.Scene;
  private readonly prevS: number[];
  private readonly frame = newFrame();

  constructor(
    private readonly cars: Car[],
    scene: THREE.Scene,
  ) {
    this.scene = scene;
    for (const c of cars) {
      const g = createCar(c.kind, c.colour);
      g.rotation.order = "YXZ";
      scene.add(g);
      this.views.push(g);
    }
    this.prevS = cars.map((c) => c.s);
  }

  dispose(): void {
    for (const v of this.views) this.scene.remove(v);
  }

  /** Call before each sim step. */
  snapshot(): void {
    this.cars.forEach((c, i) => (this.prevS[i] = c.s));
  }

  update(track: Track, alpha: number, focusS: number): void {
    const f = this.frame;
    this.cars.forEach((c, i) => {
      const g = this.views[i];
      let s = this.prevS[i] + (c.s - this.prevS[i]) * alpha;
      // Wrapped this tick: don't interpolate across the jump.
      if (Math.abs(c.s - this.prevS[i]) > 50) s = c.s;
      const vis = Math.abs(s - focusS) < VIEW_RANGE;
      g.visible = vis;
      if (!vis) return;
      track.frame(s, f);
      g.position.set(f.x + f.rx * c.d, f.y, f.z + f.rz * c.d);
      g.rotation.set(-Math.atan(f.slope) * Math.sign(c.speed), f.heading + (c.speed < 0 ? Math.PI : 0), 0);
    });
  }
}
