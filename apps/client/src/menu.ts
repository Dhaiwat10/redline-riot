import { MAX_HUMANS, RACE_SIZE, type RoomInfo } from "@rr/shared";

export interface MenuActions {
  solo(): void;
  quick(): void;
  create(): void;
  join(code: string): void;
  start(): void;
  leave(): void;
}

const COLOURS = [0xe8402a, 0x3a86ff, 0xffbe0b, 0x8338ec, 0x06d6a0, 0xff006e, 0xfb5607, 0xf1f1f1];
const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode: fine */
  }
}

/** Title screen and multiplayer lobby. */
export class Menu {
  private readonly title: HTMLElement;
  private readonly lobby: HTMLElement;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  name: string = load("rr.name", "");
  colour: number = load("rr.colour", COLOURS[0]);

  constructor(
    root: HTMLElement,
    private readonly actions: MenuActions,
  ) {
    this.title = document.createElement("div");
    this.title.className = "screen menu";
    this.lobby = document.createElement("div");
    this.lobby.className = "screen menu lobby hide";
    root.append(this.title, this.lobby);
    this.renderTitle(null);
  }

  get busy() {
    return !this.title.classList.contains("hide") && document.activeElement instanceof HTMLInputElement;
  }

  /** Shows the title screen. `joinCode` turns it into an invite landing page. */
  showTitle(joinCode: string | null, error?: string): void {
    this.stopCountdown();
    this.renderTitle(joinCode, error);
    this.title.classList.remove("hide");
    this.lobby.classList.add("hide");
  }

  hide(): void {
    this.stopCountdown();
    this.title.classList.add("hide");
    this.lobby.classList.add("hide");
  }

  setStatus(text: string): void {
    const s = this.title.querySelector<HTMLElement>(".status");
    if (s) s.textContent = text;
  }

  private renderTitle(joinCode: string | null, error?: string): void {
    const swatches = COLOURS.map((c) => `<button class="swatch ${c === this.colour ? "on" : ""}" data-colour="${c}" style="--c:${hex(c)}" aria-label="Colour"></button>`).join("");
    this.title.innerHTML = `
      <div class="logo">REDLINE<em>RIOT</em></div>
      <div class="tagline">EIGHT KILOMETRES · TWELVE RIDERS · NO RULES</div>
      <div class="rider-setup">
        <input class="name" maxlength="14" placeholder="Your name" value="${esc(this.name)}" spellcheck="false" />
        <div class="swatches">${swatches}</div>
      </div>
      <div class="buttons">
        ${
          joinCode
            ? `<button class="btn primary" data-a="join-invite">JOIN RACE ${esc(joinCode.toUpperCase())}</button>
               <button class="btn" data-a="solo">SOLO RACE</button>`
            : `<button class="btn primary" data-a="solo">SOLO RACE <kbd>ENTER</kbd></button>
               <button class="btn" data-a="quick">QUICK PLAY</button>
               <button class="btn" data-a="create">CREATE PRIVATE RACE</button>
               <form class="join"><input class="code" maxlength="5" placeholder="CODE" spellcheck="false" autocapitalize="off" /><button class="btn small">JOIN</button></form>`
        }
      </div>
      <div class="status ${error ? "error" : ""}">${error ? esc(error) : ""}</div>
      <div class="keys">
        <span><kbd>W</kbd><kbd>S</kbd></span><span>Throttle · brake</span>
        <span><kbd>A</kbd><kbd>D</kbd></span><span>Steer</span>
        <span><kbd>J</kbd><kbd>L</kbd></span><span>Punch left · right</span>
        <span><kbd>U</kbd><kbd>O</kbd></span><span>Kick left · right</span>
        <span><kbd>M</kbd></span><span>Sound on/off</span>
      </div>`;
    const nameInput = this.title.querySelector<HTMLInputElement>(".name")!;
    nameInput.addEventListener("input", () => {
      this.name = nameInput.value.trim();
      save("rr.name", this.name);
    });
    nameInput.addEventListener("keydown", (e) => e.stopPropagation());
    this.title.querySelectorAll<HTMLButtonElement>(".swatch").forEach((b) =>
      b.addEventListener("click", () => {
        this.colour = Number(b.dataset.colour);
        save("rr.colour", this.colour);
        this.title.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("on", s === b));
      }),
    );
    this.title.querySelectorAll<HTMLButtonElement>("[data-a]").forEach((b) =>
      b.addEventListener("click", () => {
        const a = b.dataset.a!;
        if (a === "solo") this.actions.solo();
        else if (a === "quick") this.actions.quick();
        else if (a === "create") this.actions.create();
        else if (a === "join-invite" && joinCode) this.actions.join(joinCode);
      }),
    );
    const form = this.title.querySelector<HTMLFormElement>("form.join");
    if (form) {
      const code = form.querySelector<HTMLInputElement>(".code")!;
      code.addEventListener("keydown", (e) => e.stopPropagation());
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (code.value.trim()) this.actions.join(code.value.trim().toLowerCase());
      });
    }
  }

  showLobby(room: RoomInfo, meId: number): void {
    this.title.classList.add("hide");
    this.lobby.classList.remove("hide");
    const host = room.hostId === meId;
    const link = `${location.origin}/r/${room.code}`;
    const ai = Math.max(0, RACE_SIZE - room.players.length);
    const rows = room.players
      .map(
        (p) =>
          `<li><span class="swatch on" style="--c:${hex(p.colour)}"></span>${esc(p.name)}${p.id === room.hostId && !room.public ? '<span class="tag">HOST</span>' : ""}${p.id === meId ? '<span class="tag you">YOU</span>' : ""}</li>`,
      )
      .join("");
    let action = "";
    if (room.state !== "lobby") action = `<div class="status">Race in progress…</div>`;
    else if (room.public) action = `<div class="status big" data-countdown></div>`;
    else if (host) action = `<button class="btn primary" data-a="start">START RACE <kbd>ENTER</kbd></button>`;
    else action = `<div class="status">Waiting for the host to start…</div>`;
    this.lobby.innerHTML = `
      <div class="kicker">${room.public ? "QUICK PLAY" : "PRIVATE RACE"}</div>
      ${
        room.public
          ? `<div class="logo small">LOBBY</div>`
          : `<div class="logo small">${room.code.toUpperCase()}</div>
             <div class="invite"><input readonly value="${link}" /><button class="btn small" data-a="copy">COPY LINK</button></div>`
      }
      <ul class="players">${rows}</ul>
      <div class="hint">${room.players.length} of ${MAX_HUMANS} riders · ${ai} AI rivals fill the grid</div>
      <div class="buttons">${action}<button class="btn ghost" data-a="leave">LEAVE</button></div>`;
    this.lobby.querySelector('[data-a="start"]')?.addEventListener("click", () => this.actions.start());
    this.lobby.querySelector('[data-a="leave"]')?.addEventListener("click", () => this.actions.leave());
    this.lobby.querySelector('[data-a="copy"]')?.addEventListener("click", (e) => {
      void navigator.clipboard?.writeText(link);
      (e.target as HTMLElement).textContent = "COPIED";
    });
    this.stopCountdown();
    const cd = this.lobby.querySelector<HTMLElement>("[data-countdown]");
    if (cd) {
      const upd = () => {
        const s = room.startsAt ? Math.max(0, Math.ceil((room.startsAt - Date.now()) / 1000)) : 0;
        cd.textContent = s > 0 ? `Starting in ${s}s` : "Starting…";
      };
      upd();
      this.countdownTimer = setInterval(upd, 250);
    }
  }

  private stopCountdown() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }
}
