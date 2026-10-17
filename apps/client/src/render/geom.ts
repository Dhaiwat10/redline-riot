import * as THREE from "three";

/**
 * Tiny toolkit for building flat-shaded, vertex-coloured low-poly models out of primitives.
 * Templates are plain arrays so they can be stamped thousands of times into one buffer.
 */
export interface Template {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
}

export class Builder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];

  add(geo: THREE.BufferGeometry, colour: THREE.ColorRepresentation, m?: THREE.Matrix4, jitter = 0, seed = 1): this {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute("uv");
    if (jitter > 0) {
      const p = g.getAttribute("position") as THREE.BufferAttribute;
      // Jitter shared positions consistently so faces stay closed.
      const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      const offs = new Map<string, [number, number, number]>();
      let s = seed;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
      for (let i = 0; i < p.count; i++) {
        const k = key(p.getX(i), p.getY(i), p.getZ(i));
        let o = offs.get(k);
        if (!o) offs.set(k, (o = [rnd() * jitter, rnd() * jitter, rnd() * jitter]));
        p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
      }
    }
    if (m) g.applyMatrix4(m);
    g.computeVertexNormals();
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    const c = new THREE.Color(colour);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
    }
    return this;
  }

  template(): Template {
    return { pos: new Float32Array(this.pos), nrm: new Float32Array(this.nrm), col: new Float32Array(this.col) };
  }

  geometry(): THREE.BufferGeometry {
    return toGeometry(this.template());
  }
}

export function toGeometry(t: Template): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(t.pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(t.nrm, 3));
  g.setAttribute("color", new THREE.BufferAttribute(t.col, 3));
  g.computeBoundingSphere();
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)).clone();
}

/** Stamps many transformed, tinted copies of templates into one geometry. */
export class Baker {
  private pos: Float32Array;
  private nrm: Float32Array;
  private col: Float32Array;
  private n = 0;

  constructor(capacityVerts: number) {
    this.pos = new Float32Array(capacityVerts * 3);
    this.nrm = new Float32Array(capacityVerts * 3);
    this.col = new Float32Array(capacityVerts * 3);
  }

  stamp(t: Template, x: number, y: number, z: number, rotY: number, scale: number, tint: number, tintG = tint, tintB = tint): void {
    const count = t.pos.length / 3;
    if ((this.n + count) * 3 > this.pos.length) this.grow((this.n + count) * 2);
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    let o = this.n * 3;
    for (let i = 0; i < t.pos.length; i += 3) {
      const px = t.pos[i] * scale;
      const py = t.pos[i + 1] * scale;
      const pz = t.pos[i + 2] * scale;
      this.pos[o] = x + px * c + pz * s;
      this.pos[o + 1] = y + py;
      this.pos[o + 2] = z - px * s + pz * c;
      const nx = t.nrm[i];
      const nz = t.nrm[i + 2];
      this.nrm[o] = nx * c + nz * s;
      this.nrm[o + 1] = t.nrm[i + 1];
      this.nrm[o + 2] = -nx * s + nz * c;
      this.col[o] = t.col[i] * tint;
      this.col[o + 1] = t.col[i + 1] * tintG;
      this.col[o + 2] = t.col[i + 2] * tintB;
      o += 3;
    }
    this.n += count;
  }

  private grow(verts: number) {
    const g = (a: Float32Array) => {
      const b = new Float32Array(verts * 3);
      b.set(a);
      return b;
    };
    this.pos = g(this.pos);
    this.nrm = g(this.nrm);
    this.col = g(this.col);
  }

  get empty() {
    return this.n === 0;
  }

  geometry(): THREE.BufferGeometry {
    return toGeometry({ pos: this.pos.slice(0, this.n * 3), nrm: this.nrm.slice(0, this.n * 3), col: this.col.slice(0, this.n * 3) });
  }
}
