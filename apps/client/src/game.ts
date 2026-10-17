import * as THREE from "three";
import {
  Attack,
  DT,
  RIVALS,
  ROAD_HALF_WIDTH,
  Race,
  SHOULDER_WIDTH,
  TICK_RATE,
  idleInput,
  type SimEvent,
} from "@rr/shared";
import { Audio } from "./audio.ts";
import { Hud, ordinal } from "./hud.ts";
import { Input } from "./input.ts";
import { ChaseCamera } from "./render/camera.ts";
import { Particles, SpeedLines } from "./render/fx.ts";
import { Post } from "./render/post.ts";
import { buildProps } from "./render/props.ts";
import { buildRoad } from "./render/road.ts";
import { RiderView, snapRider, type RiderSnap } from "./render/riderView.ts";
import { HORIZON, SUN_DIR, Sky, Water } from "./render/sky.ts";
import { Ground, Terrain } from "./render/terrain.ts";
import { TrafficView } from "./render/traffic.ts";

const SEED = 20261017;
const PLAYER_COLOUR = 0xe8402a;

type Mode = "title" | "race" | "results";

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly chase: ChaseCamera;
  private readonly post: Post;
  private readonly hud: Hud;
  private readonly audio = new Audio();
  private readonly input = new Input();
  private readonly sun: THREE.DirectionalLight;
  private readonly sky = new Sky();
  private readonly sparks = new Particles(600, true);
  private readonly dust = new Particles(500, false, 0.45);
  private readonly speedLines = new SpeedLines();

  private race!: Race;
  private ground!: Ground;
  private terrain!: Terrain;
  private water!: Water;
  private traffic!: TrafficView;
  private views: RiderView[] = [];
  private prev: RiderSnap[] = [];
  private cur: RiderSnap[] = [];

  private mode: Mode = "title";
  private acc = 0;
  private last = performance.now();
  private time = 0;
  private hitPulse = 0;
  private lastCount = -1;
  private resultsTimer = -1;
  private readonly playerInput = idleInput();
  private readonly inputs = new Map<number, typeof this.playerInput>();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", stencil: false, depth: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.chase = new ChaseCamera(innerWidth / innerHeight);
    this.scene.fog = new THREE.Fog(HORIZON, 220, 1100);
    this.scene.background = HORIZON.clone();

    this.sun = new THREE.DirectionalLight(0xffe4c0, 3.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 1;
    sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0xa9c8f0, 0x5d4a30, 1.0));
    this.scene.add(this.sky.group, this.sparks.points, this.dust.points, this.speedLines.lines);

    this.post = new Post(this.renderer, this.scene, this.chase.camera);
    this.hud = new Hud(hudRoot);

    addEventListener("resize", () => this.resize());
    addEventListener("keydown", (e) => {
      if (e.code === "KeyM") {
        this.audio.setMuted(!this.audio.muted);
        this.hud.setMuted(this.audio.muted);
      }
    });
    this.input.onStart = () => this.onStart();
  }

  /** Builds the world. Async only so the loading screen gets a frame to paint. */
  async load(): Promise<void> {
    await new Promise((r) => setTimeout(r, 30));
    this.newRace();
    const t = this.race.track;
    this.ground = new Ground(t);
    this.terrain = new Terrain(this.ground);
    this.scene.add(this.terrain.group);
    this.scene.add(buildRoad(t, this.renderer));
    this.scene.add(buildProps(t, this.race.props, this.ground));
    this.water = new Water(this.ground.seaLevel);
    this.scene.add(this.water.mesh);
    // Pre-build the area around the start so the first frame is complete.
    const start = this.views[0].bike.root.position;
    this.updateViews(1, 0);
    this.terrain.update(start.x, start.z, 1100, 400);
    this.renderer.compile(this.scene, this.chase.camera);
    this.hud.loaded();
    requestAnimationFrame(() => this.frame());
  }

  private newRace(): void {
    for (const v of this.views) v.dispose();
    const human = { name: "You", colour: PLAYER_COLOUR, human: true };
    const rivals = RIVALS.map((r) => ({ ...r, human: false }));
    // Start mid-pack.
    const entries = [...rivals.slice(0, 6), human, ...rivals.slice(6)];
    this.race = new Race(SEED, entries);
    this.playerId = this.race.riders.findIndex((r) => r.human);
    this.views = this.race.riders.map((r) => new RiderView(r, this.scene));
    this.prev = this.race.riders.map((r) => snapRider(r, {} as RiderSnap));
    this.cur = this.race.riders.map((r) => snapRider(r, {} as RiderSnap));
    if (this.traffic) this.traffic.dispose();
    this.traffic = new TrafficView(this.race.cars, this.scene);
    this.lastCount = -1;
    this.resultsTimer = -1;
  }

  private playerId = 0;
  private get me() {
    return this.race.riders[this.playerId];
  }

  private onStart(): void {
    this.audio.start();
    if (this.mode === "title") {
      this.mode = "race";
      this.hud.show("title", false);
      this.hud.setRacing(true);
    } else if (this.mode === "results") {
      this.newRace();
      this.mode = "race";
      this.hud.show("results", false);
      this.hud.setRacing(true);
    }
  }

  private resize(): void {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.post.setSize(innerWidth, innerHeight);
    this.chase.camera.aspect = innerWidth / innerHeight;
    this.chase.camera.updateProjectionMatrix();
  }

  private frame(): void {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;

    if (this.mode !== "title") {
      this.acc += dt;
      while (this.acc >= DT) {
        this.tick();
        this.acc -= DT;
      }
    }
    const alpha = this.mode === "title" ? 1 : this.acc / DT;
    this.render(dt, alpha);
  }

  private tick(): void {
    const race = this.race;
    race.riders.forEach((r, i) => {
      const p = this.prev[i];
      this.prev[i] = this.cur[i];
      this.cur[i] = p;
    });
    this.traffic.snapshot();
    const me = this.me;
    this.inputs.set(me.id, this.input.sample(DT, this.playerInput));
    const events = race.step(this.inputs);
    race.riders.forEach((r, i) => snapRider(r, this.cur[i]));
    for (const e of events) this.onEvent(e);

    // Countdown display.
    if (race.phase === "countdown") {
      const n = Math.ceil(race.countdown / TICK_RATE);
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.hud.countdown(n);
        this.audio.beep(false);
      }
    }
    if (this.resultsTimer > 0 && --this.resultsTimer === 0) {
      this.mode = "results";
      this.hud.setRacing(false);
      this.hud.clearMessage();
      this.hud.results(race, me);
    }
  }

  private onEvent(e: SimEvent): void {
    const me = this.me;
    const near = (id: number) => {
      const r = this.race.riders[id];
      return Math.max(0, 1 - Math.abs(r.s - me.s) / 120);
    };
    switch (e.type) {
      case "start":
        this.hud.countdown(0);
        this.audio.beep(true);
        break;
      case "hit": {
        const involved = e.attacker === me.id || e.target === me.id;
        const vol = involved ? 1 : near(e.target) * 0.6;
        if (e.attack === Attack.Kick) this.audio.kick(vol);
        else this.audio.punch(vol);
        const t = this.views[e.target].bike.root.position;
        for (let i = 0; i < 14; i++)
          this.dust.emit(t.x, t.y + 1.3, t.z, (Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4, new THREE.Color(0xfff2dc), 0.35, 0.4, 2);
        if (e.target === me.id) {
          this.chase.shake(0.45);
          this.hitPulse = 1;
          this.hud.flash();
        } else if (e.attacker === me.id) this.chase.shake(0.18);
        break;
      }
      case "crash": {
        const r = this.race.riders[e.rider];
        this.audio.crash(e.rider === me.id ? 1 : near(e.rider) * 0.7);
        if (e.rider === me.id) {
          this.chase.shake(0.9);
          this.hitPulse = 1;
          const by = e.by !== undefined ? this.race.riders[e.by].name.toUpperCase() : null;
          this.hud.message(by ? `KNOCKED OFF<small>BY ${by}</small>` : e.cause === "car" ? `WIPEOUT!<small>WATCH THE TRAFFIC</small>` : "WIPEOUT!", 2.4);
        } else if (e.by === me.id) {
          this.hud.message(`TAKEDOWN<small>${r.name.toUpperCase()} IS EATING ASPHALT</small>`, 2);
        }
        break;
      }
      case "bump":
        if (e.a === me.id || e.b === me.id) {
          this.audio.bump(Math.min(1, e.strength * 2));
          this.chase.shake(0.08);
        }
        break;
      case "finish":
        if (e.rider === me.id) {
          this.hud.message(`FINISHED<small>${e.place}${ordinal(e.place).toUpperCase()} PLACE</small>`, 3);
          this.resultsTimer = TICK_RATE * 3;
        }
        break;
      case "remount":
        break;
    }
  }

  private updateViews(alpha: number, dt: number): void {
    const t = this.race.track;
    this.views.forEach((v, i) => v.update(this.prev[i], this.cur[i], alpha, dt, t, this.time));
  }

  private render(dt: number, alpha: number): void {
    const race = this.race;
    const me = this.me;
    const mi = race.riders.indexOf(me);
    this.updateViews(alpha, dt);
    this.traffic.update(race.track, alpha, me.s);

    const cam = this.chase.camera;
    if (this.mode !== "race") this.titleCamera();
    else this.chase.update(me, this.prev[mi], this.cur[mi], alpha, race.track, dt, this.time);

    // Shadow frustum follows the player.
    const focus = this.views[mi].bike.root.position;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(SUN_DIR, 200);
    this.sky.follow(cam, focus.y);
    this.water.update(cam, this.time);
    this.terrain.update(cam.position.x, cam.position.z, 1100, 2);

    this.emitParticles(dt);
    this.sparks.update(dt);
    this.dust.update(dt);
    this.speedLines.update(cam, this.mode === "race" && me.mode === "riding" ? me.speed : 0);

    this.hitPulse = Math.max(0, this.hitPulse - dt * 2.5);
    this.post.setIntensity(this.mode === "race" ? Math.min(1, me.speed / 66) : 0, this.hitPulse);
    this.post.render(dt);

    if (this.mode === "race") this.hud.update(race, me, dt);
    this.updateAudio();
  }

  private titleCamera(): void {
    const cam = this.chase.camera;
    const mi = this.race.riders.indexOf(this.me);
    const p = this.views[mi].bike.root.position;
    const a = this.time * 0.12 + 2.2;
    cam.position.set(p.x + Math.sin(a) * 14, p.y + 3.2 + Math.sin(this.time * 0.3) * 0.6, p.z + Math.cos(a) * 14);
    cam.lookAt(this.tmp.set(p.x, p.y + 1.1, p.z));
    if (cam.fov !== 50) {
      cam.fov = 50;
      cam.updateProjectionMatrix();
    }
  }

  private emitParticles(dt: number): void {
    const edge = ROAD_HALF_WIDTH + SHOULDER_WIDTH;
    const spark = new THREE.Color(1.0, 0.62, 0.25).multiplyScalar(4);
    const dustC = new THREE.Color(0xb59e7a);
    this.race.riders.forEach((r, i) => {
      const v = this.views[i];
      if (r.mode === "riding" && Math.abs(r.d) > edge && r.speed > 8 && Math.random() < dt * 40) {
        const p = v.bike.rear.getWorldPosition(this.tmp);
        this.dust.emit(p.x, p.y - 0.1, p.z, (Math.random() - 0.5) * 2, 0.6 + Math.random(), (Math.random() - 0.5) * 2, dustC, 0.45, 1.0, 3, -0.3);
      }
      const c = r.crash;
      if (c && Math.abs(c.bikeVs) > 2.5) {
        const p = v.bike.root.position;
        const n = Math.ceil(Math.abs(c.bikeVs) * dt * 12);
        for (let k = 0; k < n; k++) {
          this.sparks.emit(p.x, p.y + 0.15, p.z, (Math.random() - 0.5) * 6, 1 + Math.random() * 3, (Math.random() - 0.5) * 6, spark, 0.09, 0.35 + Math.random() * 0.3, 0, 9);
        }
        if (Math.random() < dt * 20) this.dust.emit(p.x, p.y + 0.2, p.z, 0, 0.8, 0, dustC, 1.2, 1.4, 2.5);
      }
      if (c && r.mode === "crashing" && c.bodyH < 0.1 && Math.abs(c.bodyVs) > 3 && Math.random() < dt * 25) {
        const p = v.rig.root.getWorldPosition(this.tmp2);
        this.dust.emit(p.x, p.y, p.z, 0, 0.6, 0, dustC, 1.0, 1.0, 2);
      }
    });
  }

  private updateAudio(): void {
    const me = this.me;
    let nearest = Infinity;
    let rivalRpm = 0.3;
    for (const r of this.race.riders) {
      if (r === me) continue;
      const d = Math.hypot(r.s - me.s, r.d - me.d);
      if (d < nearest) {
        nearest = d;
        rivalRpm = r.rpm;
      }
    }
    const c = me.crash;
    this.audio.update({
      rpm: this.mode === "title" ? 0.15 : me.rpm,
      throttle: this.playerInput.throttle,
      speed: me.mode === "riding" ? me.speed : 0,
      riding: me.mode === "riding",
      scrape: c ? Math.min(1, Math.abs(c.bikeVs) / 20) : 0,
      rivalRpm,
      rivalDist: this.mode === "title" ? 100 : nearest,
    });
  }
}
