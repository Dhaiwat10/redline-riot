import * as THREE from "three";

const DOWN = new THREE.Vector3(0, -1, 0);
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();

/**
 * Two-bone IK. `upper` and `lower` are pivots whose bones hang along -y; `lower` is a
 * child at the end of `upper`. `root` and `target` are in upper's parent space; `pole`
 * is the direction the middle joint should bend toward.
 */
export function solveTwoBone(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  root: THREE.Vector3,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  l1: number,
  l2: number,
  blend = 1,
): void {
  _n.subVectors(target, root);
  let d = _n.length();
  _n.normalize();
  d = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-3), (l1 + l2) * 0.999);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _p.copy(pole).addScaledVector(_n, -pole.dot(_n));
  if (_p.lengthSq() < 1e-6) _p.set(0, 0, 1);
  _p.normalize();
  _e.copy(root).addScaledVector(_n, a).addScaledVector(_p, h);
  _d1.subVectors(_e, root).normalize();
  _d2.copy(root).addScaledVector(_n, d).sub(_e).normalize();

  _q.setFromUnitVectors(DOWN, _d1);
  if (blend >= 1) upper.quaternion.copy(_q);
  else upper.quaternion.slerp(_q, blend);
  _qi.copy(upper.quaternion).invert();
  _d2.applyQuaternion(_qi);
  _q.setFromUnitVectors(DOWN, _d2);
  if (blend >= 1) lower.quaternion.copy(_q);
  else lower.quaternion.slerp(_q, blend);
}
