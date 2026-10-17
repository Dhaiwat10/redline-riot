import { Attack, type RiderInput } from "@rr/shared";

/** Keyboard + gamepad → RiderInput. Attacks are latched until the next sim tick consumes them. */
export class Input {
  private keys = new Set<string>();
  private steer = 0;
  private pending: { attack: Attack; side: -1 | 1 } | null = null;
  private padPrev: boolean[] = [];
  onStart: (() => void) | null = null;

  constructor() {
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const attack: Record<string, [Attack, -1 | 1]> = {
        KeyJ: [Attack.Punch, -1],
        KeyL: [Attack.Punch, 1],
        KeyU: [Attack.Kick, -1],
        KeyO: [Attack.Kick, 1],
        KeyZ: [Attack.Punch, -1],
        KeyX: [Attack.Punch, 1],
      };
      const a = attack[e.code];
      if (a) this.pending = { attack: a[0], side: a[1] };
      if (e.code === "Enter" || e.code === "Space") this.onStart?.();
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => this.keys.clear());
  }

  private down(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  /** Called once per sim tick. */
  sample(dt: number, out: RiderInput): RiderInput {
    let throttle = this.down("KeyW", "ArrowUp") ? 1 : 0;
    let brake = this.down("KeyS", "ArrowDown") ? 1 : 0;
    const left = this.down("KeyA", "ArrowLeft");
    const right = this.down("KeyD", "ArrowRight");
    // Keyboard steering ramps in and snaps back, so taps make small corrections.
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = target === 0 ? 7 : Math.sign(target) !== Math.sign(this.steer) ? 9 : 3.2;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer));
    let steer = this.steer;

    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) steer = Math.sign(ax) * Math.pow((Math.abs(ax) - 0.12) / 0.88, 1.4);
      throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0, pad.buttons[0]?.pressed ? 1 : 0);
      brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
      const press = (i: number) => {
        const now = !!pad.buttons[i]?.pressed;
        const was = this.padPrev[i];
        this.padPrev[i] = now;
        return now && !was;
      };
      if (press(2)) this.pending = { attack: Attack.Punch, side: -1 };
      if (press(1)) this.pending = { attack: Attack.Punch, side: 1 };
      if (press(4)) this.pending = { attack: Attack.Kick, side: -1 };
      if (press(5)) this.pending = { attack: Attack.Kick, side: 1 };
      if (press(9)) this.onStart?.();
    }

    out.throttle = throttle;
    out.brake = brake;
    out.steer = steer;
    out.attack = this.pending?.attack ?? Attack.None;
    out.attackSide = this.pending?.side ?? 1;
    this.pending = null;
    return out;
  }
}
