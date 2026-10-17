import * as THREE from "three";

/** Soft round sprite for particles. */
function dotTexture(): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const g = cv.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.4, "rgba(255,255,255,0.6)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

const dot = dotTexture();

/** CPU particle pool rendered as sized, coloured points. */
export class Particles {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly grow: Float32Array;
  private readonly gravity: Float32Array;
  private next = 0;

  constructor(
    private readonly max: number,
    additive: boolean,
    opacity = 1,
  ) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.gravity = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { map: { value: dot }, scale: { value: 600 }, opacity: { value: opacity } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha;
        uniform float scale;
        void main() {
          vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(size * scale / -mv.z, 140.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform float opacity; varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha * opacity);
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, colour: THREE.Color, size: number, life: number, grow = 0, gravity = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([colour.r, colour.g, colour.b], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.grow[i] = grow;
    this.gravity[i] = gravity;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.vel[i * 3 + 1] -= this.gravity[i] * dt;
      const drag = Math.exp(-dt * 2);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * t);
      this.alpha[i] = Math.max(0, 1 - t) * (t < 0.1 ? t * 10 : 1);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
  }
}

/** Faint wind streaks that whip past the camera at speed. */
export class SpeedLines {
  readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly anchor: Float32Array;
  private readonly n = 90;
  private readonly mat: THREE.LineBasicMaterial;
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor() {
    this.pos = new Float32Array(this.n * 6);
    this.anchor = new Float32Array(this.n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
  }

  update(camera: THREE.Camera, speed: number): void {
    camera.getWorldDirection(this.fwd);
    this.right.crossVectors(this.fwd, camera.up).normalize();
    this.up.crossVectors(this.right, this.fwd).normalize();
    const p = camera.position;
    const k = Math.max(0, (speed - 32) / 30);
    this.mat.opacity = Math.min(0.1, k * 0.1);
    const len = 0.5 + speed * 0.06;
    for (let i = 0; i < this.n; i++) {
      let ax = this.anchor[i * 3];
      let ay = this.anchor[i * 3 + 1];
      let az = this.anchor[i * 3 + 2];
      const rx = ax - p.x;
      const ry = ay - p.y;
      const rz = az - p.z;
      const along = rx * this.fwd.x + ry * this.fwd.y + rz * this.fwd.z;
      if (along < 0.5 || along > 70 || (ax === 0 && az === 0)) {
        const dist = 8 + Math.random() * 60;
        const a = Math.random() * Math.PI * 2;
        const rad = 2.5 + Math.random() * 7;
        ax = p.x + this.fwd.x * dist + (this.right.x * Math.cos(a) + this.up.x * Math.sin(a)) * rad;
        ay = p.y + this.fwd.y * dist + (this.right.y * Math.cos(a) + this.up.y * Math.sin(a)) * rad;
        az = p.z + this.fwd.z * dist + (this.right.z * Math.cos(a) + this.up.z * Math.sin(a)) * rad;
        this.anchor.set([ax, ay, az], i * 3);
      }
      this.pos.set([ax, ay, az, ax - this.fwd.x * len, ay - this.fwd.y * len, az - this.fwd.z * len], i * 6);
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
