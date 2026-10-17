import { Attack } from "@rr/shared";

/** True on phones and tablets (or any device whose main pointer is a finger). */
export const isTouchDevice = () => matchMedia("(pointer: coarse)").matches;

/**
 * On-screen controls. Left half: drag sideways to steer (analog, from wherever your thumb lands).
 * Right side: brake and attack buttons. Throttle is automatic while touch controls are in use.
 */
export class TouchControls {
  readonly root: HTMLElement;
  steer = 0;
  brake = false;
  /** Set when a touch was used recently, so the keyboard/gamepad path stays untouched. */
  active = false;
  private pending: { attack: Attack; side: -1 | 1 } | null = null;
  private steerPointer = -1;
  private originX = 0;
  private readonly knob: HTMLElement;
  private readonly pad: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "touch hide";
    this.root.innerHTML = `
      <div class="steer-zone"><div class="steer-pad"><div class="steer-knob"></div></div></div>
      <div class="buttons-zone">
        <button class="tbtn kick l" data-attack="kick" data-side="-1">KICK</button>
        <button class="tbtn kick r" data-attack="kick" data-side="1">KICK</button>
        <button class="tbtn punch l" data-attack="punch" data-side="-1">◀ PUNCH</button>
        <button class="tbtn punch r" data-attack="punch" data-side="1">PUNCH ▶</button>
        <button class="tbtn brake" data-brake>BRAKE</button>
      </div>`;
    parent.append(this.root);
    this.pad = this.root.querySelector(".steer-pad")!;
    this.knob = this.root.querySelector(".steer-knob")!;

    const zone = this.root.querySelector<HTMLElement>(".steer-zone")!;
    zone.addEventListener("pointerdown", (e) => {
      if (this.steerPointer >= 0) return;
      e.preventDefault();
      capture(zone, e.pointerId);
      this.steerPointer = e.pointerId;
      this.originX = e.clientX;
      this.active = true;
      // Centre the pad under the thumb.
      this.pad.style.left = `${e.clientX}px`;
      this.pad.style.top = `${e.clientY}px`;
      this.pad.classList.add("on");
      this.setSteer(0);
    });
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.steerPointer) return;
      const range = Math.min(110, innerWidth * 0.09);
      this.setSteer((e.clientX - this.originX) / range);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.steerPointer) return;
      this.steerPointer = -1;
      this.pad.classList.remove("on");
      this.setSteer(0);
    };
    zone.addEventListener("pointerup", release);
    zone.addEventListener("pointercancel", release);

    this.root.querySelectorAll<HTMLButtonElement>(".tbtn").forEach((b) => {
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        capture(b, e.pointerId);
        b.classList.add("down");
        this.active = true;
        if (b.dataset.brake !== undefined) this.brake = true;
        else this.pending = { attack: b.dataset.attack === "kick" ? Attack.Kick : Attack.Punch, side: Number(b.dataset.side) as -1 | 1 };
      });
      const up = () => {
        b.classList.remove("down");
        if (b.dataset.brake !== undefined) this.brake = false;
      };
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    });
  }

  private setSteer(v: number) {
    // Small dead zone, then a gentle curve for fine control near the centre.
    const c = Math.max(-1, Math.min(1, v));
    const mag = Math.max(0, (Math.abs(c) - 0.06) / 0.94);
    this.steer = Math.sign(c) * Math.pow(mag, 1.3);
    this.knob.style.transform = `translateX(${c * 46}px)`;
  }

  /** Attack pressed since the last tick, if any. */
  takeAttack() {
    const p = this.pending;
    this.pending = null;
    return p;
  }

  show(on: boolean) {
    this.root.classList.toggle("hide", !on);
    if (!on) {
      this.brake = false;
      this.steerPointer = -1;
      this.pad.classList.remove("on");
      this.setSteer(0);
    }
  }
}

/** Short buzz on Android; silently does nothing elsewhere. */
export function buzz(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}

/** Pointer capture keeps a drag alive when the thumb slides off; losing it must not lose the press. */
function capture(el: HTMLElement, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* pointer already gone */
  }
}
