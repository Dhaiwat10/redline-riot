import * as THREE from "three";
import type { CarKind } from "@rr/shared";
import { Builder, mat } from "./geom.ts";

/*
 * Local model space: +z forward, +y up, so the rider's right-hand side is -x.
 */

export const vcMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.15 });
const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xfff1c9, emissiveIntensity: 4 });
const tailMaterial = new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff1a0a, emissiveIntensity: 3 });

export const WHEEL_R = 0.33;
export const WHEELBASE = 1.42;

function wheel(): THREE.BufferGeometry {
  const b = new Builder();
  b.add(new THREE.TorusGeometry(WHEEL_R - 0.07, 0.075, 6, 14), 0x161616, mat(0, 0, 0, 0, Math.PI / 2));
  b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10), 0x8d8f94, mat(0, 0, 0, 0, 0, Math.PI / 2));
  // Spokes so the spin reads.
  for (let i = 0; i < 3; i++) b.add(new THREE.BoxGeometry(0.035, 0.42, 0.035), 0x3a3a3e, mat(0, 0, 0, (i * Math.PI) / 3));
  return b.geometry();
}

function bikeBody(colour: number): THREE.BufferGeometry {
  const b = new Builder();
  const dark = 0x1d1d20;
  const chrome = 0xb9bcc2;
  // Frame and engine block.
  b.add(new THREE.BoxGeometry(0.3, 0.34, 0.62), 0x2b2b2f, mat(0, 0.52, 0.02));
  b.add(new THREE.BoxGeometry(0.22, 0.12, 1.15), dark, mat(0, 0.72, -0.05, -0.12));
  for (const x of [-0.12, 0.12]) b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), chrome, mat(x, 0.58, 0.1, 0, 0, Math.PI / 2 - 0.0001));
  // Tank, seat, tail.
  b.add(new THREE.BoxGeometry(0.36, 0.22, 0.5), colour, mat(0, 0.93, 0.2, 0.08), 0.02, 4);
  b.add(new THREE.BoxGeometry(0.3, 0.09, 0.48), 0x121212, mat(0, 0.9, -0.28, 0.06));
  b.add(new THREE.BoxGeometry(0.24, 0.12, 0.36), colour, mat(0, 0.94, -0.62, -0.18));
  // Fairing and screen.
  b.add(new THREE.BoxGeometry(0.42, 0.34, 0.26), colour, mat(0, 0.98, 0.62, -0.5), 0.02, 5);
  b.add(new THREE.BoxGeometry(0.32, 0.16, 0.03), 0x5e7380, mat(0, 1.18, 0.62, -0.75));
  // Forks and bars.
  for (const x of [-0.1, 0.1]) b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6), chrome, mat(x, 0.66, 0.6, 0.38));
  b.add(new THREE.BoxGeometry(0.7, 0.04, 0.04), 0x222222, mat(0, 1.08, 0.48));
  // Swingarm.
  for (const x of [-0.12, 0.12]) b.add(new THREE.BoxGeometry(0.05, 0.06, 0.62), 0x333336, mat(x, 0.38, -0.4, 0.08));
  // Exhaust.
  b.add(new THREE.CylinderGeometry(0.06, 0.07, 0.75, 7), chrome, mat(-0.2, 0.45, -0.45, Math.PI / 2 + 0.15));
  b.add(new THREE.CylinderGeometry(0.075, 0.075, 0.1, 7), 0x2b2b2b, mat(-0.2, 0.5, -0.83, Math.PI / 2 + 0.15));
  // Mudguard.
  b.add(new THREE.BoxGeometry(0.16, 0.04, 0.44), dark, mat(0, 0.69, WHEELBASE / 2, 0.15));
  return b.geometry();
}

export interface BikeRig {
  root: THREE.Group; // at road contact, faces +z
  lean: THREE.Group; // rolls around z
  front: THREE.Mesh;
  rear: THREE.Mesh;
  seat: THREE.Object3D; // where the rider's hips go
}

let wheelGeo: THREE.BufferGeometry | null = null;

export function createBike(colour: number): BikeRig {
  wheelGeo ??= wheel();
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  const body = new THREE.Mesh(bikeBody(colour), vcMaterial);
  body.castShadow = true;
  lean.add(body);
  const front = new THREE.Mesh(wheelGeo, vcMaterial);
  front.position.set(0, WHEEL_R, WHEELBASE / 2);
  front.castShadow = true;
  const rear = new THREE.Mesh(wheelGeo, vcMaterial);
  rear.position.set(0, WHEEL_R, -WHEELBASE / 2);
  rear.castShadow = true;
  lean.add(front, rear);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.04), lampMaterial);
  head.position.set(0, 0.98, 0.78);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.03), tailMaterial);
  tail.position.set(0, 0.97, -0.81);
  lean.add(head, tail);
  const seat = new THREE.Object3D();
  seat.position.set(0, 0.97, -0.26);
  lean.add(seat);
  return { root, lean, front, rear, seat };
}

/** A limb segment: a pivot group with a box hanging along -y. */
function limb(len: number, w: number, colour: number, endCap?: { size: number; colour: number }) {
  const pivot = new THREE.Group();
  const b = new Builder();
  b.add(new THREE.BoxGeometry(w, len, w), colour, mat(0, -len / 2, 0));
  if (endCap) b.add(new THREE.BoxGeometry(endCap.size, endCap.size, endCap.size * 1.3), endCap.colour, mat(0, -len - endCap.size * 0.3, endCap.size * 0.2));
  const m = new THREE.Mesh(b.geometry(), vcMaterial);
  m.castShadow = true;
  pivot.add(m);
  const end = new THREE.Group();
  end.position.y = -len;
  pivot.add(end);
  return { pivot, end };
}

export interface RiderRig {
  root: THREE.Group; // hips
  torso: THREE.Group;
  head: THREE.Group;
  shoulders: [THREE.Group, THREE.Group]; // [left(+x), right(-x)]
  elbows: [THREE.Group, THREE.Group];
  hips: [THREE.Group, THREE.Group];
  knees: [THREE.Group, THREE.Group];
}

const LEATHER = 0x1e1b1a;

export function createRider(colour: number): RiderRig {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const tb = new Builder();
  tb.add(new THREE.BoxGeometry(0.4, 0.58, 0.24), LEATHER, mat(0, 0.29, 0), 0.015, 7);
  tb.add(new THREE.BoxGeometry(0.42, 0.12, 0.25), colour, mat(0, 0.38, 0));
  tb.add(new THREE.BoxGeometry(0.36, 0.1, 0.22), 0x2a2522, mat(0, 0.02, 0));
  const tm = new THREE.Mesh(tb.geometry(), vcMaterial);
  tm.castShadow = true;
  torso.add(tm);
  const head = new THREE.Group();
  head.position.set(0, 0.66, 0.02);
  torso.add(head);
  const hb = new Builder();
  hb.add(new THREE.IcosahedronGeometry(0.17, 1), colour, mat(0, 0.1, 0, 0, 0, 0, 1, 1, 1.12));
  hb.add(new THREE.BoxGeometry(0.26, 0.09, 0.1), 0x0b0d12, mat(0, 0.11, 0.14));
  hb.add(new THREE.BoxGeometry(0.05, 0.05, 0.3), 0xf5f5f5, mat(0, 0.25, -0.02));
  const hm = new THREE.Mesh(hb.geometry(), vcMaterial);
  hm.castShadow = true;
  head.add(hm);

  const shoulders: THREE.Group[] = [];
  const elbows: THREE.Group[] = [];
  for (const side of [1, -1]) {
    const upper = limb(0.3, 0.11, LEATHER);
    upper.pivot.position.set(side * 0.24, 0.52, 0);
    torso.add(upper.pivot);
    const fore = limb(0.29, 0.1, LEATHER, { size: 0.11, colour: 0x111111 });
    upper.end.add(fore.pivot);
    shoulders.push(upper.pivot);
    elbows.push(fore.pivot);
  }
  const hips: THREE.Group[] = [];
  const knees: THREE.Group[] = [];
  for (const side of [1, -1]) {
    const thigh = limb(0.44, 0.15, 0x24262d);
    thigh.pivot.position.set(side * 0.13, 0, 0);
    root.add(thigh.pivot);
    const shin = limb(0.46, 0.13, 0x24262d, { size: 0.14, colour: 0x0f0f0f });
    thigh.end.add(shin.pivot);
    hips.push(thigh.pivot);
    knees.push(shin.pivot);
  }
  return {
    root,
    torso,
    head,
    shoulders: shoulders as [THREE.Group, THREE.Group],
    elbows: elbows as [THREE.Group, THREE.Group],
    hips: hips as [THREE.Group, THREE.Group],
    knees: knees as [THREE.Group, THREE.Group],
  };
}

function carBody(kind: CarKind): THREE.BufferGeometry {
  const b = new Builder();
  const paint = 0xffffff;
  const glass = 0x26313a;
  const trim = 0x1a1a1a;
  if (kind === "van") {
    b.add(new THREE.BoxGeometry(1.95, 1.65, 4.3), paint, mat(0, 1.25, -0.35));
    b.add(new THREE.BoxGeometry(1.9, 1.0, 1.0), paint, mat(0, 0.95, 2.1, 0.12));
    b.add(new THREE.BoxGeometry(1.8, 0.62, 0.05), glass, mat(0, 1.55, 2.0, -0.45));
    b.add(new THREE.BoxGeometry(1.97, 0.5, 2.6), glass, mat(0, 1.65, 0.3, 0, 0, 0, 1, 1, 1));
  } else if (kind === "pickup") {
    b.add(new THREE.BoxGeometry(1.9, 0.75, 5.3), paint, mat(0, 0.78, 0));
    b.add(new THREE.BoxGeometry(1.8, 0.7, 1.7), paint, mat(0, 1.5, 0.55));
    b.add(new THREE.BoxGeometry(1.82, 0.5, 1.4), glass, mat(0, 1.55, 0.6));
    b.add(new THREE.BoxGeometry(1.7, 0.1, 2.1), 0x2a2622, mat(0, 1.16, -1.5));
    for (const x of [-0.9, 0.9]) b.add(new THREE.BoxGeometry(0.08, 0.38, 2.1), paint, mat(x, 1.35, -1.5));
    b.add(new THREE.BoxGeometry(1.88, 0.38, 0.08), paint, mat(0, 1.35, -2.58));
  } else {
    b.add(new THREE.BoxGeometry(1.85, 0.62, 4.55), paint, mat(0, 0.7, 0), 0.02, 3);
    b.add(new THREE.BoxGeometry(1.62, 0.55, 2.3), paint, mat(0, 1.27, -0.25));
    b.add(new THREE.BoxGeometry(1.64, 0.42, 2.0), glass, mat(0, 1.29, -0.25));
    b.add(new THREE.BoxGeometry(1.5, 0.05, 0.9), glass, mat(0, 1.2, 1.05, -0.55));
  }
  const len = kind === "van" ? 5.2 : kind === "pickup" ? 5.4 : 4.6;
  b.add(new THREE.BoxGeometry(1.9, 0.18, 0.2), trim, mat(0, 0.45, len / 2));
  b.add(new THREE.BoxGeometry(1.9, 0.18, 0.2), trim, mat(0, 0.45, -len / 2));
  for (const z of [len / 2 - 0.95, -len / 2 + 0.95]) {
    for (const x of [-0.85, 0.85]) b.add(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10), 0x141414, mat(x, 0.34, z, 0, 0, Math.PI / 2));
  }
  return b.geometry();
}

const carGeoCache = new Map<CarKind, THREE.BufferGeometry>();
const lampGeo = new THREE.BoxGeometry(0.32, 0.14, 0.05);

export function createCar(kind: CarKind, colour: number): THREE.Group {
  let geo = carGeoCache.get(kind);
  if (!geo) carGeoCache.set(kind, (geo = carBody(kind)));
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, color: colour, roughness: 0.35, metalness: 0.35 });
  const body = new THREE.Mesh(geo, paint);
  body.castShadow = true;
  g.add(body);
  const len = kind === "van" ? 5.2 : kind === "pickup" ? 5.4 : 4.6;
  for (const x of [-0.65, 0.65]) {
    const h = new THREE.Mesh(lampGeo, lampMaterial);
    h.position.set(x, 0.78, len / 2 + 0.01);
    const t = new THREE.Mesh(lampGeo, tailMaterial);
    t.position.set(x, 0.85, -len / 2 - 0.01);
    g.add(h, t);
  }
  return g;
}
