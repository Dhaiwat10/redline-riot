import * as THREE from "three";
import { Builder, mat, type Template } from "./geom.ts";

/** Low-poly scenery templates. All sizes in metres, origin at the base. */
function pine(): Template {
  const b = new Builder();
  b.add(new THREE.CylinderGeometry(0.16, 0.26, 3, 6), 0x5a3e2b, mat(0, 1.5, 0));
  const greens = [0x2f5d34, 0x356a3a, 0x3d7642];
  for (let i = 0; i < 3; i++) {
    const r = 2.3 - i * 0.6;
    b.add(new THREE.ConeGeometry(r, 3.2, 7), greens[i], mat(0, 2.6 + i * 1.9, 0, 0, i * 0.6), 0.18, 3 + i);
  }
  return b.template();
}

function redwood(): Template {
  const b = new Builder();
  b.add(new THREE.CylinderGeometry(0.45, 0.95, 22, 7), 0x7a3b22, mat(0, 11, 0), 0.06, 9);
  b.add(new THREE.CylinderGeometry(0.9, 1.3, 1.2, 7), 0x6a321d, mat(0, 0.5, 0));
  const greens = [0x24452a, 0x2a5230, 0x2f5a34, 0x335f38];
  for (let i = 0; i < 4; i++) {
    const r = 3.4 - i * 0.65;
    b.add(new THREE.ConeGeometry(r, 4.8, 7), greens[i], mat(0, 13.5 + i * 3.2, 0, 0, i * 0.9), 0.35, 11 + i);
  }
  return b.template();
}

function cypress(): Template {
  const b = new Builder();
  b.add(new THREE.CylinderGeometry(0.18, 0.32, 3.2, 6), 0x6b4a33, mat(0.2, 1.5, 0, 0, 0, -0.18));
  b.add(new THREE.IcosahedronGeometry(2.6, 0), 0x3e6a3a, mat(0.7, 4, 0, 0, 0, 0, 1.5, 0.55, 1.2), 0.35, 21);
  b.add(new THREE.IcosahedronGeometry(1.9, 0), 0x47753f, mat(-0.9, 4.6, 0.6, 0, 1, 0, 1.3, 0.5, 1.1), 0.3, 22);
  return b.template();
}

function oak(): Template {
  const b = new Builder();
  b.add(new THREE.CylinderGeometry(0.22, 0.35, 2.6, 6), 0x5d4330, mat(0, 1.3, 0));
  b.add(new THREE.IcosahedronGeometry(2.2, 0), 0x6e8a3c, mat(0, 3.8, 0, 0, 0, 0, 1.2, 0.85, 1.2), 0.4, 31);
  b.add(new THREE.IcosahedronGeometry(1.5, 0), 0x7b9643, mat(1.1, 3.2, 0.5), 0.3, 32);
  return b.template();
}

function rock(): Template {
  const b = new Builder();
  b.add(new THREE.IcosahedronGeometry(0.8, 0), 0x8c867c, mat(0, 0.35, 0, 0, 0, 0, 1.2, 0.75, 1), 0.22, 41);
  return b.template();
}

function boulder(): Template {
  const b = new Builder();
  b.add(new THREE.DodecahedronGeometry(1.4, 0), 0x7e786f, mat(0, 0.7, 0, 0.3, 0, 0, 1.3, 0.85, 1.1), 0.35, 51);
  b.add(new THREE.DodecahedronGeometry(0.8, 0), 0x6f6a62, mat(1.2, 0.3, 0.4), 0.2, 52);
  return b.template();
}

function bush(): Template {
  const b = new Builder();
  b.add(new THREE.IcosahedronGeometry(0.7, 0), 0x5a7a34, mat(0, 0.35, 0, 0, 0, 0, 1.3, 0.7, 1.1), 0.18, 61);
  return b.template();
}

function pole(): Template {
  const b = new Builder();
  b.add(new THREE.CylinderGeometry(0.11, 0.14, 9, 6), 0x5b4535, mat(0, 4.5, 0));
  b.add(new THREE.BoxGeometry(2.0, 0.12, 0.12), 0x4d3a2c, mat(0, 8.3, 0));
  for (const x of [-0.85, 0, 0.85]) b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 5), 0x6d8c8f, mat(x, 8.45, 0));
  return b.template();
}

function chevron(): Template {
  const b = new Builder();
  b.add(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 5), 0x9c9c9c, mat(0, 0.7, 0));
  b.add(new THREE.BoxGeometry(0.75, 0.75, 0.04), 0xf2c41a, mat(0, 1.55, 0));
  // Black chevron, pointing +x: two slanted bars.
  b.add(new THREE.BoxGeometry(0.42, 0.11, 0.05), 0x141414, mat(0.02, 1.66, 0.006, 0, 0, -0.75));
  b.add(new THREE.BoxGeometry(0.42, 0.11, 0.05), 0x141414, mat(0.02, 1.44, 0.006, 0, 0, 0.75));
  return b.template();
}

let cache: Record<string, Template> | null = null;
export function flora(): Record<"pine" | "redwood" | "cypress" | "oak" | "rock" | "boulder" | "bush" | "pole" | "chevron", Template> {
  if (!cache) cache = { pine: pine(), redwood: redwood(), cypress: cypress(), oak: oak(), rock: rock(), boulder: boulder(), bush: bush(), pole: pole(), chevron: chevron() };
  return cache as ReturnType<typeof flora>;
}
