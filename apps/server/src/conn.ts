import type { WebSocket } from "ws";
import type { ServerMsg } from "@rr/shared";

/**
 * A client socket, optionally with simulated latency for testing netcode locally.
 * Delays keep message order (as TCP would) while adding jitter.
 */
export class Conn {
  private sendAt = 0;
  private recvAt = 0;

  constructor(
    private readonly ws: WebSocket,
    private readonly lagMs: number,
    private readonly jitterMs: number,
  ) {
    // Protocol errors (oversized or broken frames) close the socket; they must not throw.
    ws.on("error", (e) => {
      console.warn("socket error:", e.message);
      ws.terminate();
    });
  }

  get open() {
    return this.ws.readyState === this.ws.OPEN;
  }

  private delay(prev: number): number {
    if (this.lagMs <= 0 && this.jitterMs <= 0) return 0;
    const at = Math.max(prev, Date.now() + this.lagMs / 2 + Math.random() * this.jitterMs);
    return at;
  }

  private later(at: number, fn: () => void) {
    if (at === 0) fn();
    else setTimeout(fn, Math.max(0, at - Date.now()));
  }

  send(msg: ServerMsg): void {
    const text = JSON.stringify(msg);
    this.sendAt = this.delay(this.sendAt);
    this.later(this.sendAt, () => this.open && this.ws.send(text));
  }

  sendBinary(data: Uint8Array): void {
    this.sendAt = this.delay(this.sendAt);
    this.later(this.sendAt, () => this.open && this.ws.send(data));
  }

  /** Wraps an incoming-message handler with the simulated receive delay. */
  onMessage(handler: (data: Buffer | string, binary: boolean) => void): void {
    this.ws.on("message", (data, isBinary) => {
      this.recvAt = this.delay(this.recvAt);
      const payload = isBinary ? (data as Buffer) : data.toString();
      this.later(this.recvAt, () => handler(payload, isBinary));
    });
  }

  onClose(handler: () => void): void {
    this.ws.on("close", handler);
  }

  close(): void {
    this.ws.close();
  }
}
