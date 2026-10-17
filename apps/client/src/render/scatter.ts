import * as THREE from "three";
import { ROAD_HALF_WIDTH, Rng } from "@rr/shared";
import { flora } from "./flora.ts";
import { Baker } from "./geom.ts";
import type { Ground, GroundInfo } from "./terrain.ts";

let material: THREE.MeshStandardMaterial | null = null;

/** Decorative trees and rocks for one terrain chunk, baked into a single mesh. */
export function buildScatter(ground: Ground, x0: number, z0: number, size: number, seed: number): THREE.Mesh | null {
  const rng = new Rng(seed);
  const f = flora();
  const baker = new Baker(20000);
  const info: GroundInfo = { s: 0, d: 0, roadY: 0, coast: 0, forest: 0, alpine: 0 };
  const attempts = 70;
  for (let i = 0; i < attempts; i++) {
    const x = x0 + rng.next() * size;
    const z = z0 + rng.next() * size;
    const y = ground.sample(x, z, info);
    const ad = Math.abs(info.d);
    // Near-road props come from the shared sim; leave that band alone.
    if (ad < ROAD_HALF_WIDTH + 28) continue;
    if (y < ground.seaLevel + 1.5) continue;
    const r = rng.next();
    const density = info.forest * 1 + info.alpine * 0.45 + info.coast * 0.18;
    if (r > density) {
      // Sparse areas still get the occasional rock or bush.
      if (rng.chance(0.25)) baker.stamp(rng.chance(0.5) ? f.bush : f.rock, x, y - 0.1, z, rng.next() * 6.28, rng.range(0.7, 1.6), rng.range(0.85, 1.1));
      continue;
    }
    const highAlpine = info.alpine > 0.5 && y > info.roadY + 40;
    if (highAlpine) {
      baker.stamp(f.boulder, x, y - 0.3, z, rng.next() * 6.28, rng.range(0.8, 2.5), rng.range(0.85, 1.1));
      continue;
    }
    const pick = rng.next();
    let t = f.pine;
    let scale = rng.range(0.8, 1.6);
    if (info.forest > 0.5) {
      t = pick < 0.55 ? f.redwood : pick < 0.9 ? f.pine : f.bush;
      if (t === f.redwood) scale = rng.range(0.8, 1.5);
    } else if (info.coast > 0.5) {
      t = pick < 0.45 ? f.cypress : pick < 0.75 ? f.oak : f.bush;
    } else {
      t = pick < 0.8 ? f.pine : f.rock;
    }
    const tint = rng.range(0.82, 1.12);
    baker.stamp(t, x, y - 0.15, z, rng.next() * 6.28, scale, tint, tint * rng.range(0.95, 1.05), tint);
  }
  if (baker.empty) return null;
  material ??= new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const mesh = new THREE.Mesh(baker.geometry(), material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}
