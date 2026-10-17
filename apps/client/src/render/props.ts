import * as THREE from "three";
import { newFrame, type Prop, type PropKind, type Track } from "@rr/shared";
import { flora } from "./flora.ts";
import { toGeometry } from "./geom.ts";
import type { Ground } from "./terrain.ts";

/** Roadside props shared with the simulation, drawn as one instanced mesh per kind. */
export function buildProps(track: Track, props: Prop[], ground: Ground): THREE.Group {
  const group = new THREE.Group();
  const f = flora();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  const frame = newFrame();
  const byKind = new Map<PropKind, Prop[]>();
  for (const p of props) {
    let arr = byKind.get(p.kind);
    if (!arr) byKind.set(p.kind, (arr = []));
    arr.push(p);
  }
  const dummy = new THREE.Object3D();
  const c = new THREE.Color();
  for (const [kind, list] of byKind) {
    const geo = toGeometry(f[kind]);
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((p, i) => {
      track.frame(p.s, frame);
      const x = frame.x + frame.rx * p.d;
      const z = frame.z + frame.rz * p.d;
      const y = kind === "chevron" ? frame.y - 0.1 : ground.sample(x, z) - 0.15;
      dummy.position.set(x, y, z);
      if (kind === "chevron") {
        // Face oncoming riders; arrow points into the bend.
        dummy.rotation.set(0, Math.atan2(-frame.fx, -frame.fz), 0);
        dummy.scale.set(p.d > 0 ? -1 : 1, 1, 1);
      } else if (kind === "pole") {
        dummy.rotation.set(0, frame.heading + Math.PI / 2, 0);
        dummy.scale.setScalar(1);
      } else {
        dummy.rotation.set(0, p.rot, 0);
        dummy.scale.setScalar(p.scale);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const tint = 0.85 + ((i * 2654435761) % 1000) / 1000 * 0.3;
      mesh.setColorAt(i, c.setRGB(tint, tint, tint));
    });
    mesh.castShadow = kind !== "chevron";
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}
