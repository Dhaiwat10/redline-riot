import * as THREE from "three";
import {
  Attack,
  DT,
  RIVALS,
  ROAD_HALF_WIDTH,
  Race,
  SHOULDER_WIDTH,
  TICK_RATE,
  TRACK_SEED,
  idleInput,
  type RacerEntry,
  type RoomInfo,
  type ServerMsg,
  type SimEvent,
} from "@rr/shared";
import { Audio } from "./audio.ts";
import { Hud, ordinal } from "./hud.ts";
import { Input } from "./input.ts";
import { ResolutionScaler, pickQuality, type Quality } from "./quality.ts";
import { TouchControls, buzz, isTouchDevice } from "./touch.ts";
import { Menu } from "./menu.ts";
import { Net } from "./net.ts";
import { OnlineRace } from "./online.ts";
import { ChaseCamera, fitFov } from "./render/camera.ts";
import { Particles, SpeedLines } from "./render/fx.ts";
import { Post } from "./render/post.ts";
import { buildProps } from "./render/props.ts";
import { buildRoad } from "./render/road.ts";
import { RiderView, snapRider, type RiderSnap } from "./render/riderView.ts";
import { HORIZON, SUN_DIR, Sky, Water } from "./render/sky.ts";
import { Ground, Terrain } from "./render/terrain.ts";
import { TrafficView } from "./render/traffic.ts";

type Mode = "title" | "lobby" | "race" | "results";

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
  private readonly menu: Menu;
  private readonly quality: Quality = pickQuality();
  private readonly scaler: ResolutionScaler;
  private readonly touch: TouchControls;
  private readonly net = new Net();
  private online: OnlineRace | null = null;
  private room: RoomInfo | null = null;
  private myId = -1;

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
    this.renderer.setPixelRatio(this.quality.maxPixelRatio);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.chase = new ChaseCamera(innerWidth / innerHeight);
    this.scene.fog = new THREE.Fog(HORIZON, 220 * (this.quality.viewDistance / 1100), this.quality.viewDistance);
    this.scene.background = HORIZON.clone();

    this.sun = new THREE.DirectionalLight(0xffe4c0, 3.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
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

    this.post = new Post(this.renderer, this.scene, this.chase.camera, this.quality);
    this.scaler = new ResolutionScaler(this.quality, (ratio) => {
      this.renderer.setPixelRatio(ratio);
      this.post.setSize(innerWidth, innerHeight);
    });
    this.hud = new Hud(hudRoot);
    this.touch = new TouchControls(hudRoot);
    this.input.touch = this.touch;
    this.hud.onAgain = () => this.solo();
    this.menu = new Menu(hudRoot, {
      solo: () => this.solo(),
      quick: () => void this.goOnline({ t: "quick" }),
      create: () => void this.goOnline({ t: "create" }),
      join: (code) => void this.goOnline({ t: "join", code }),
      start: () => this.net.send({ t: "start" }),
      leave: () => this.leaveRoom(),
    });
    this.net.onMessage = (m) => this.onServer(m);
    this.net.onSnapshot = (s) => this.online?.receive(s);
    this.net.onClose = () => {
      if (this.room || this.online) this.backToTitle("Lost connection to the race server.");
    };

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
    this.newRace(new Race(TRACK_SEED, soloEntries()));
    const t = this.race.track;
    this.ground = new Ground(t);
    this.terrain = new Terrain(this.ground, this.quality.scatter);
    this.scene.add(this.terrain.group);
    this.scene.add(buildRoad(t, this.renderer));
    this.scene.add(buildProps(t, this.race.props, this.ground));
    this.water = new Water(this.ground.seaLevel);
    this.scene.add(this.water.mesh);
    // Pre-build the area around the start so the first frame is complete.
    const start = this.views[0].bike.root.position;
    this.updateViews(1, 0);
    this.terrain.update(start.x, start.z, this.quality.viewDistance, 400);
    this.renderer.compile(this.scene, this.chase.camera);
    this.hud.loaded();
    const invite = location.pathname.match(/^\/r\/([a-z0-9]{5})$/i);
    this.menu.showTitle(invite ? invite[1].toLowerCase() : null);
    requestAnimationFrame(() => this.frame());
  }

  private newRace(race: Race, playerId = race.riders.findIndex((r) => r.human)): void {
    for (const v of this.views) v.dispose();
    this.race = race;
    this.playerId = playerId;
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
    if (this.mode === "title" && !this.menu.busy) this.solo();
    else if (this.mode === "results" && !this.online) this.solo();
    else if (this.mode === "lobby" && this.room && !this.room.public && this.room.hostId === this.myId) this.net.send({ t: "start" });
  }

  private solo(): void {
    this.audio.start();
    this.online = null;
    const entries = soloEntries(this.menu.name || "You", this.menu.colour);
    this.newRace(new Race(TRACK_SEED, entries));
    this.enterRace();
  }

  private enterRace(): void {
    this.mode = "race";
    if (isTouchDevice()) {
      this.touch.show(true);
      this.touch.active = true;
      goFullscreen();
    }
    this.acc = 0;
    this.menu.hide();
    this.hud.hideResults();
    this.hud.setRacing(true);
    this.hud.setPing(this.online ? this.net.rtt : null);
  }

  private async goOnline(msg: { t: "quick" } | { t: "create" } | { t: "join"; code: string }): Promise<void> {
    this.audio.start();
    this.menu.setStatus("Connecting…");
    try {
      await this.net.connect();
    } catch (e) {
      this.menu.setStatus((e as Error).message);
      return;
    }
    this.net.send({ t: "hello", name: this.menu.name || "Rider", colour: this.menu.colour });
    this.net.send(msg);
  }

  private leaveRoom(): void {
    this.net.send({ t: "leave" });
    this.backToTitle();
  }

  private backToTitle(error?: string): void {
    this.online = null;
    this.room = null;
    this.mode = "title";
    this.hud.setRacing(false);
    this.hud.hideResults();
    this.hud.setPing(null);
    history.replaceState(null, "", "/");
    this.menu.showTitle(null, error);
  }

  private onServer(m: ServerMsg): void {
    switch (m.t) {
      case "welcome":
        this.myId = m.playerId;
        break;
      case "room": {
        this.room = m.room;
        history.replaceState(null, "", m.room.public ? "/" : `/r/${m.room.code}`);
        if (m.room.state === "lobby") {
          if (this.mode !== "lobby") {
            this.mode = "lobby";
            this.online = null;
            this.hud.setRacing(false);
            this.hud.hideResults();
            this.hud.setPing(null);
          }
          this.menu.showLobby(m.room, this.myId);
        } else if (m.room.state === "results" && this.online && this.mode === "race") {
          this.mode = "results";
          this.online.syncAll();
          this.hud.setRacing(false);
          this.hud.clearMessage();
          this.hud.results(this.race, this.me, "BACK TO THE LOBBY IN A FEW SECONDS");
        } else if (this.mode === "lobby") {
          this.menu.showLobby(m.room, this.myId);
        }
        break;
      }
      case "start":
        this.online = new OnlineRace(this.net, m.entries, m.seed, m.riderId);
        this.newRace(this.online.race, m.riderId);
        this.enterRace();
        break;
      case "error":
        if (this.mode === "title") this.menu.setStatus(m.message);
        else this.backToTitle(m.message);
        break;
      case "left":
      case "pong":
        break;
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
    this.scaler.update(dt);
    const touchRace = this.mode === "race" && isTouchDevice();
    this.touch.show(touchRace);
    document.body.classList.toggle("touch-race", touchRace);

    const simulating = this.mode === "race" || this.mode === "results";
    if (simulating) {
      this.acc += dt;
      while (this.acc >= DT) {
        this.tick();
        this.acc -= DT;
      }
    }
    const alpha = simulating ? this.acc / DT : 1;
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
    const events = this.online ? this.online.tick(this.playerInput) : race.step(this.inputs);
    race.riders.forEach((r, i) => snapRider(r, this.cur[i]));
    if (this.online && me.mode === "riding") {
      // Hide prediction corrections by gliding the visual position back.
      this.cur[me.id].s += this.online.error.s;
      this.cur[me.id].d += this.online.error.d;
    }
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
          buzz(40);
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
          buzz([80, 40, 120]);
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
          if (!this.online) this.resultsTimer = TICK_RATE * 3;
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
    this.terrain.update(cam.position.x, cam.position.z, this.quality.viewDistance, 2);

    this.emitParticles(dt);
    this.sparks.update(dt);
    this.dust.update(dt);
    this.speedLines.update(cam, this.mode === "race" && me.mode === "riding" ? me.speed : 0);

    this.hitPulse = Math.max(0, this.hitPulse - dt * 2.5);
    this.post.setIntensity(this.mode === "race" ? Math.min(1, me.speed / 66) : 0, this.hitPulse);
    this.post.render(dt);

    if (this.mode === "race") {
      this.hud.update(race, me, dt);
      if (this.online) this.hud.setPing(this.net.rtt);
    }
    this.updateAudio();
  }

  private titleCamera(): void {
    const cam = this.chase.camera;
    const mi = this.race.riders.indexOf(this.me);
    const p = this.views[mi].bike.root.position;
    const a = this.time * 0.12 + 2.2;
    cam.position.set(p.x + Math.sin(a) * 14, p.y + 3.2 + Math.sin(this.time * 0.3) * 0.6, p.z + Math.cos(a) * 14);
    cam.lookAt(this.tmp.set(p.x, p.y + 1.1, p.z));
    const titleFov = fitFov(50, cam.aspect);
    if (cam.fov !== titleFov) {
      cam.fov = titleFov;
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
      rpm: this.mode === "race" ? me.rpm : 0.15,
      throttle: this.playerInput.throttle,
      speed: me.mode === "riding" ? me.speed : 0,
      riding: me.mode === "riding",
      scrape: c ? Math.min(1, Math.abs(c.bikeVs) / 20) : 0,
      rivalRpm,
      rivalDist: this.mode === "race" ? nearest : 100,
    });
  }
}

function soloEntries(name = "You", colour = 0xe8402a): RacerEntry[] {
  const rivals = RIVALS.map((r) => ({ ...r, human: false }));
  // Start mid-pack.
  return [...rivals.slice(0, 6), { name, colour, human: true }, ...rivals.slice(6)];
}

/** Fullscreen where the browser allows it (Android Chrome); no-op elsewhere. */
function goFullscreen(): void {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: "hide" })
    .catch(() => {});
}
