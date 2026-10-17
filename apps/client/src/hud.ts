import { COUNTDOWN_TICKS, MPS_TO_MPH, TICK_RATE, type Race, type RiderState } from "@rr/shared";

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
};
const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
};

/** DOM overlay. Cheap per-frame updates: only touches nodes whose content changed. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly dots: HTMLElement[] = [];
  private readonly tach: HTMLElement[] = [];
  private msgTimer = 0;
  private cache = new Map<string, string>();

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="flash" data-k="flash"></div>
      <div class="top hide" data-k="top">
        <div class="place" data-k="place"></div>
        <div class="timer"><span>TIME</span><b data-k="time">0:00.00</b></div>
      </div>
      <div class="progress hide" data-k="progress"><div class="fill" data-k="fill"></div><span class="flag">🏁</span></div>
      <div class="bars hide" data-k="bars">
        <div class="bar"><label><span>STAMINA</span></label><div class="track"><b data-k="hp"></b></div></div>
        <div class="bar bike"><label><span>BIKE</span><span data-k="bikeName"></span></label><div class="track"><b data-k="bike"></b></div></div>
      </div>
      <div class="speedo hide" data-k="speedo">
        <div><span class="gear" data-k="gear">1</span><span class="mph" data-k="mph">0</span></div>
        <div class="unit">MPH</div>
        <div class="tach" data-k="tach"></div>
      </div>
      <div class="rival left hide" data-k="rivalL"><div class="tag">LEFT</div><div class="name" data-k="rivalLName"></div><div class="track"><b data-k="rivalLHp"></b></div></div>
      <div class="rival right hide" data-k="rivalR"><div class="tag">RIGHT</div><div class="name" data-k="rivalRName"></div><div class="track"><b data-k="rivalRHp"></b></div></div>
      <div class="msg" data-k="msg"></div>
      <div class="count" data-k="count"></div>
      <div class="mute" data-k="mute">M · SOUND OFF</div>
      <div class="screen" data-k="title">
        <div class="logo">REDLINE<em>RIOT</em></div>
        <div class="tagline">EIGHT KILOMETRES · TWELVE RIDERS · NO RULES</div>
        <div class="cta">PRESS ENTER TO RIDE</div>
        <div class="keys">
          <span><kbd>W</kbd><kbd>S</kbd></span><span>Throttle · brake</span>
          <span><kbd>A</kbd><kbd>D</kbd></span><span>Steer</span>
          <span><kbd>J</kbd><kbd>L</kbd></span><span>Punch left · right</span>
          <span><kbd>U</kbd><kbd>O</kbd></span><span>Kick left · right</span>
          <span><kbd>M</kbd></span><span>Mute</span>
        </div>
      </div>
      <div class="screen results hide" data-k="results"></div>
      <div class="loading" data-k="loading">BUILDING THE ROAD…</div>
    `;
    root.querySelectorAll<HTMLElement>("[data-k]").forEach((n) => (this.el[n.dataset.k!] = n));
    for (let i = 0; i < 14; i++) {
      const t = document.createElement("i");
      this.el.tach.append(t);
      this.tach.push(t);
    }
  }

  private set(key: string, html: string) {
    if (this.cache.get(key) === html) return;
    this.cache.set(key, html);
    this.el[key].innerHTML = html;
  }

  show(key: string, on: boolean) {
    this.el[key].classList.toggle("hide", !on);
  }

  setRacing(on: boolean) {
    for (const k of ["top", "progress", "bars", "speedo"]) this.show(k, on);
    if (!on) {
      this.show("rivalL", false);
      this.show("rivalR", false);
    }
  }

  loaded() {
    this.el.loading.style.opacity = "0";
    setTimeout(() => this.el.loading.remove(), 700);
  }

  setMuted(m: boolean) {
    this.set("mute", m ? "M · SOUND OFF" : "M · SOUND ON");
  }

  countdown(n: number) {
    const go = n === 0;
    this.el.count.innerHTML = `<span class="${go ? "go" : ""}">${go ? "GO!" : n}</span>`;
  }

  message(html: string, seconds = 1.8) {
    this.el.msg.innerHTML = html;
    this.el.msg.classList.add("show");
    this.msgTimer = seconds;
  }

  clearMessage() {
    this.msgTimer = 0;
    this.el.msg.classList.remove("show");
  }

  flash() {
    const f = this.el.flash;
    f.classList.add("on");
    requestAnimationFrame(() => f.classList.remove("on"));
  }

  update(race: Race, me: RiderState, dt: number) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.el.msg.classList.remove("show");
    }
    const n = race.riders.length;
    this.set("place", `${me.place}<small>${ordinal(me.place)}</small><span class="of">OF ${n}</span>`);
    this.set("time", fmtTime(me.finished ? (me.finishTick - COUNTDOWN_TICKS) / TICK_RATE : race.time));
    this.set("mph", String(Math.round(me.speed * MPS_TO_MPH)));
    this.set("gear", me.mode === "riding" ? String(me.gear) : "–");
    this.set("bikeName", me.bike.name.toUpperCase());
    const hp = Math.max(0, me.health);
    this.el.hp.style.width = `${hp}%`;
    this.el.hp.classList.toggle("low", hp < 25);
    this.el.bike.style.width = `${100 - me.bikeDamage}%`;
    const lit = Math.round(me.rpm * this.tach.length);
    this.tach.forEach((t, i) => {
      t.classList.toggle("on", i < lit);
      t.classList.toggle("hot", i >= this.tach.length - 3);
    });

    // Progress bar.
    const len = race.track.finishLine;
    this.el.fill.style.width = `${Math.min(100, (me.s / len) * 100)}%`;
    while (this.dots.length < n) {
      const d = document.createElement("span");
      d.className = "dot";
      this.el.progress.append(d);
      this.dots.push(d);
    }
    race.riders.forEach((r, i) => {
      const d = this.dots[i];
      d.classList.toggle("me", r === me);
      d.style.left = `${Math.min(100, (r.s / len) * 100)}%`;
      if (r !== me) d.style.background = hex(r.colour);
    });

    // Closest rider on each side, Road Rash style.
    let left: RiderState | null = null;
    let right: RiderState | null = null;
    let lBest = 7;
    let rBest = 7;
    for (const r of race.riders) {
      if (r === me || r.mode !== "riding" || me.mode !== "riding") continue;
      const ds = Math.abs(r.s - me.s);
      if (ds > 6) continue;
      const dd = r.d - me.d;
      const score = ds + Math.abs(dd) * 0.5;
      if (dd < 0 && score < lBest) {
        lBest = score;
        left = r;
      } else if (dd >= 0 && score < rBest) {
        rBest = score;
        right = r;
      }
    }
    this.rival("L", left);
    this.rival("R", right);
  }

  private rival(side: "L" | "R", r: RiderState | null) {
    const box = this.el[`rival${side}`];
    box.classList.toggle("hide", !r);
    if (!r) return;
    box.style.setProperty("--c", hex(r.colour));
    this.set(`rival${side}Name`, r.name.toUpperCase());
    this.el[`rival${side}Hp`].style.width = `${Math.max(0, r.health)}%`;
  }

  results(race: Race, me: RiderState) {
    const rows = [...race.riders]
      .sort((a, b) => a.place - b.place)
      .map(
        (r) =>
          `<tr class="${r === me ? "me" : ""}"><td>${r.place}</td><td><span class="swatch" style="background:${hex(r.colour)}"></span>${r.name}</td><td>${
            r.finished ? fmtTime((r.finishTick - COUNTDOWN_TICKS) / TICK_RATE) : "—"
          }</td></tr>`,
      )
      .join("");
    this.el.results.innerHTML = `
      <div class="logo" style="font-size:72px">${me.place}<small style="font-size:32px">${ordinal(me.place)}</small> PLACE</div>
      <table>${rows}</table>
      <div class="cta">PRESS ENTER TO RACE AGAIN</div>`;
    this.show("results", true);
  }
}
