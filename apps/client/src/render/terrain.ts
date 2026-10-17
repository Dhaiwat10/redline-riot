import * as THREE from "three";
import { ROAD_HALF_WIDTH, SHOULDER_WIDTH, fbm2, newFrame, smoothstep, valueNoise2, type Track } from "@rr/shared";
import { buildScatter } from "./scatter.ts";

const CHUNK = 96;
const RES = 3;
const N = CHUNK / RES + 1;

/** Height of the natural ground at a world position, shaped around the road. */
export class Ground {
  readonly seaLevel: number;
  private readonly proj = { s: 0, d: 0, dist: 0 };

  constructor(readonly track: Track) {
    // Sea sits well below the coast road.
    let minCoast = Infinity;
    for (let s = 0; s < track.length; s += 20) if (track.biomeWeights(s).coast > 0.5) minCoast = Math.min(minCoast, track.heightAt(s));
    this.seaLevel = (Number.isFinite(minCoast) ? minCoast : 0) - 16;
  }

  /** Returns height and fills `info` with track-space data for colouring. */
  sample(x: number, z: number, info?: GroundInfo): number {
    const p = this.track.project(x, z, this.proj);
    const roadY = this.track.heightAt(p.s);
    const ad = Math.abs(p.d);
    const w = this.track.biomeWeights(p.s);

    const far = smoothstep(14, 160, ad);
    const hillAmp = w.coast * 22 + w.forest * 30 + w.alpine * 85;
    let natural = roadY + fbm2(x * 0.0045, z * 0.0045, 5, 11) * hillAmp * far + far * (w.alpine * 25 + w.forest * 6);
    // Small undulation everywhere so verges are not perfectly flat.
    natural += valueNoise2(x * 0.08, z * 0.08, 3) * 0.35 * smoothstep(ROAD_HALF_WIDTH + 3, ROAD_HALF_WIDTH + 12, ad);
    // Coast: the land falls away into the sea on the left of the road.
    if (w.coast > 0 && p.d < 0) natural -= w.coast * smoothstep(14, 90, -p.d) * (34 + 10 * fbm2(x * 0.01, z * 0.01, 3, 5));
    // Flatten into the road with a gentle verge.
    const blend = smoothstep(ROAD_HALF_WIDTH + SHOULDER_WIDTH + 0.5, ROAD_HALF_WIDTH + SHOULDER_WIDTH + 16, ad);
    const h = roadY - 0.3 + (natural - roadY + 0.3) * blend;
    if (info) {
      info.s = p.s;
      info.d = p.d;
      info.roadY = roadY;
      info.coast = w.coast;
      info.forest = w.forest;
      info.alpine = w.alpine;
    }
    return h;
  }
}

export interface GroundInfo {
  s: number;
  d: number;
  roadY: number;
  coast: number;
  forest: number;
  alpine: number;
}

const C = (hex: number) => new THREE.Color(hex);
const PAL = {
  grassCoast: C(0x7fa64e),
  grassDry: C(0xa9a660),
  grassForest: C(0x4f7a35),
  forestFloor: C(0x5b4a2e),
  grassAlpine: C(0x5f8a46),
  rock: C(0x8a8378),
  rockDark: C(0x5f5a52),
  sand: C(0xe0cf9f),
  snow: C(0xf4f6f8),
  gravel: C(0x9b917f),
};

/** Streams terrain chunks (plus their decorative scatter) in and out around the camera. */
export class Terrain {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<string, THREE.Object3D>();
  private readonly wanted = new Set<string>();
  private readonly material: THREE.MeshStandardMaterial;

  constructor(
    readonly ground: Ground,
    private readonly scatterDensity = 1,
  ) {
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 });
    // Pre-compute which chunks touch the road corridor.
    const t = ground.track;
    const frame = newFrame();
    for (let s = 0; s < t.length; s += 24) {
      const f = t.frame(s, frame);
      for (let dx = -300; dx <= 300; dx += CHUNK / 2) {
        for (let dz = -300; dz <= 300; dz += CHUNK / 2) {
          if (dx * dx + dz * dz > 300 * 300) continue;
          this.wanted.add(this.key(Math.floor((f.x + dx) / CHUNK), Math.floor((f.z + dz) / CHUNK)));
        }
      }
    }
  }

  private key(cx: number, cz: number) {
    return `${cx},${cz}`;
  }

  /** Builds missing chunks near (x,z) and drops far ones. `budget` caps chunks built this call. */
  update(x: number, z: number, radius: number, budget: number): void {
    const cx0 = Math.floor(x / CHUNK);
    const cz0 = Math.floor(z / CHUNK);
    const r = Math.ceil(radius / CHUNK);
    const todo: [number, number, number][] = [];
    for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
      for (let cz = cz0 - r; cz <= cz0 + r; cz++) {
        const k = this.key(cx, cz);
        if (!this.wanted.has(k) || this.chunks.has(k)) continue;
        const ddx = (cx + 0.5) * CHUNK - x;
        const ddz = (cz + 0.5) * CHUNK - z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 > radius * radius) continue;
        todo.push([cx, cz, d2]);
      }
    }
    todo.sort((a, b) => a[2] - b[2]);
    for (let i = 0; i < Math.min(budget, todo.length); i++) this.build(todo[i][0], todo[i][1]);

    const drop = (radius + CHUNK * 2) ** 2;
    for (const [k, obj] of this.chunks) {
      const [cx, cz] = k.split(",").map(Number);
      const ddx = (cx + 0.5) * CHUNK - x;
      const ddz = (cz + 0.5) * CHUNK - z;
      if (ddx * ddx + ddz * ddz > drop) {
        this.group.remove(obj);
        obj.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
        this.chunks.delete(k);
      }
    }
  }

  private build(cx: number, cz: number): void {
    const ground = this.ground;
    const pos = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const info: GroundInfo = { s: 0, d: 0, roadY: 0, coast: 0, forest: 0, alpine: 0 };
    const infos: GroundInfo[] = [];
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = x0 + i * RES;
        const z = z0 + j * RES;
        const h = ground.sample(x, z, info);
        const k = (j * N + i) * 3;
        pos[k] = x;
        pos[k + 1] = h;
        pos[k + 2] = z;
        infos.push({ ...info });
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i;
        const b = a + 1;
        const c = a + N;
        const d = c + 1;
        // Alternate the diagonal for a less regular low-poly look.
        if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const nrm = geo.getAttribute("normal") as THREE.BufferAttribute;

    const c = new THREE.Color();
    const tmp = new THREE.Color();
    for (let v = 0; v < N * N; v++) {
      const g = infos[v];
      const x = pos[v * 3];
      const y = pos[v * 3 + 1];
      const z = pos[v * 3 + 2];
      const ny = nrm.getY(v);
      const n = valueNoise2(x * 0.05, z * 0.05, 9) * 0.5 + 0.5;
      // Biome base colour.
      c.copy(PAL.grassCoast).lerp(PAL.grassDry, n * 0.7);
      c.multiplyScalar(g.coast);
      tmp.copy(PAL.grassForest).lerp(PAL.forestFloor, n * 0.6).multiplyScalar(g.forest);
      c.add(tmp);
      tmp.copy(PAL.grassAlpine).lerp(PAL.grassDry, n * 0.4).multiplyScalar(g.alpine);
      c.add(tmp);
      // Rock on steep ground.
      const steep = smoothstep(0.82, 0.62, ny);
      tmp.copy(PAL.rock).lerp(PAL.rockDark, n);
      c.lerp(tmp, steep);
      // Beaches just above the waterline.
      const shore = 1 - smoothstep(ground.seaLevel + 1.5, ground.seaLevel + 5, y);
      c.lerp(PAL.sand, shore * g.coast);
      // Snow caps in the mountains.
      const snow = smoothstep(g.roadY + 35, g.roadY + 60, y) * g.alpine;
      c.lerp(PAL.snow, snow * (0.6 + 0.4 * ny));
      // Gravel verge next to the road.
      const verge = 1 - smoothstep(ROAD_HALF_WIDTH + SHOULDER_WIDTH + 0.5, ROAD_HALF_WIDTH + SHOULDER_WIDTH + 3.5, Math.abs(g.d));
      c.lerp(PAL.gravel, verge * 0.8);
      col[v * 3] = c.r;
      col[v * 3 + 1] = c.g;
      col[v * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    const holder = new THREE.Group();
    holder.add(mesh);
    const scatter = buildScatter(ground, x0, z0, CHUNK, cx * 7919 + cz * 104729, this.scatterDensity);
    if (scatter) holder.add(scatter);
    this.group.add(holder);
    this.chunks.set(this.key(cx, cz), holder);
  }
}
