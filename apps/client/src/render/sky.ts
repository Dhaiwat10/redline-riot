import * as THREE from "three";
import { fbm2 } from "@rr/shared";

export const SUN_DIR = new THREE.Vector3(-0.55, 0.32, 0.77).normalize();
export const HORIZON = new THREE.Color(0xf3d2a8);
const ZENITH = new THREE.Color(0x2f6fc4);
const MID = new THREE.Color(0x9cc4e8);
const SUN = new THREE.Color(0xffe2b0);

/** Gradient sky dome with a soft sun, plus a ring of distant hazy mountains. */
export class Sky {
  readonly group = new THREE.Group();

  constructor() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: ZENITH.clone() },
        horizon: { value: HORIZON.clone() },
        mid: { value: MID.clone() },
        sunColor: { value: SUN.clone() },
        sunDir: { value: SUN_DIR.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 zenith; uniform vec3 horizon; uniform vec3 mid; uniform vec3 sunColor; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.12, h));
          col = mix(col, zenith, smoothstep(0.08, 0.7, h));
          // Below the horizon fade to haze.
          col = mix(col, horizon * 0.92, smoothstep(0.0, -0.15, d.y));
          float sd = max(dot(d, sunDir), 0.0);
          col += sunColor * (pow(sd, 6.0) * 0.35 + pow(sd, 60.0) * 0.8);
          col += sunColor * smoothstep(0.9993, 0.9997, sd) * 6.0;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), mat);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);
    this.group.add(this.mountains());
  }

  private mountains(): THREE.Mesh {
    const segs = 220;
    const R = 3200;
    const pos: number[] = [];
    const col: number[] = [];
    const near = new THREE.Color(0x7b8aa0);
    const far = new THREE.Color(0xa9b2c0);
    for (const [layer, radius, height, c] of [
      [0, R, 520, far],
      [1, R * 0.82, 360, near],
    ] as const) {
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        const h0 = height * (0.35 + 0.65 * Math.abs(fbm2(Math.cos(a0) * 3 + layer * 10, Math.sin(a0) * 3, 4, 5)) * 1.6);
        const h1 = height * (0.35 + 0.65 * Math.abs(fbm2(Math.cos(a1) * 3 + layer * 10, Math.sin(a1) * 3, 4, 5)) * 1.6);
        const p = (a: number, h: number) => [Math.sin(a) * radius, h, Math.cos(a) * radius];
        const tri = [p(a0, -200), p(a1, -200), p(a1, h1), p(a0, -200), p(a1, h1), p(a0, h0)];
        for (const v of tri) {
          pos.push(...v);
          // Lighter toward the base where haze is thicker.
          const t = Math.max(0, v[1]) / (height * 1.5);
          const cc = HORIZON.clone().lerp(c, 0.55 + t * 0.45);
          col.push(cc.r, cc.g, cc.b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide, depthWrite: false }));
    m.renderOrder = -9;
    m.frustumCulled = false;
    return m;
  }

  follow(camera: THREE.Camera, baseY: number): void {
    this.group.position.set(camera.position.x, baseY - 60, camera.position.z);
  }
}

export function waterNormalMap(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const g = cv.getContext("2d")!;
  const img = g.createImageData(S, S);
  const h = (x: number, y: number) =>
    Math.sin((x / S) * Math.PI * 2 * 3 + Math.sin((y / S) * Math.PI * 2 * 2) * 1.5) * 0.5 +
    Math.sin((y / S) * Math.PI * 2 * 5 + Math.cos((x / S) * Math.PI * 2 * 4)) * 0.3 +
    fbm2(x / 32, y / 32, 3, 77) * 0.4;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const n = new THREE.Vector3(-dx * 2, -dy * 2, 1).normalize();
      const k = (y * S + x) * 4;
      img.data[k] = (n.x * 0.5 + 0.5) * 255;
      img.data[k + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[k + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly normal: THREE.Texture;

  constructor(level: number) {
    this.normal = waterNormalMap();
    this.normal.repeat.set(220, 220);
    const m = new THREE.MeshStandardMaterial({ color: 0x1d5876, roughness: 0.08, metalness: 0.2, normalMap: this.normal, normalScale: new THREE.Vector2(0.35, 0.35) });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), m);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = level;
    this.mesh.receiveShadow = true;
  }

  update(camera: THREE.Camera, time: number): void {
    // Snap to a grid so the texture does not swim with the camera.
    const step = 5000 / 220;
    this.mesh.position.x = Math.round(camera.position.x / step) * step;
    this.mesh.position.z = Math.round(camera.position.z / step) * step;
    this.normal.offset.set(time * 0.004, time * 0.0025);
  }
}
