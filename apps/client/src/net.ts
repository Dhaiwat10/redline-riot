import { decodeSnapshot, encodeInput, isSnapshotFrame, type ClientMsg, type InputFrame, type ServerMsg, type Snapshot } from "@rr/shared";

/** WebSocket link to the game server. */
export class Net {
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** Smoothed round-trip time in ms. */
  rtt = 100;
  onMessage: (m: ServerMsg) => void = () => {};
  onSnapshot: (s: Snapshot) => void = () => {};
  onClose: () => void = () => {};

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    const url = import.meta.env.VITE_SERVER_URL ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        this.ws = ws;
        this.pingTimer = setInterval(() => this.send({ t: "ping", at: performance.now() }), 1000);
        resolve();
      };
      ws.onerror = () => reject(new Error("Can't reach the race server."));
      ws.onclose = () => {
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.ws = null;
        this.onClose();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") {
          const bytes = new Uint8Array(ev.data as ArrayBuffer);
          if (isSnapshotFrame(bytes)) this.onSnapshot(decodeSnapshot(bytes));
          return;
        }
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.t === "pong") {
          const sample = performance.now() - msg.at;
          this.rtt = this.rtt * 0.8 + sample * 0.2;
        }
        this.onMessage(msg);
      };
    });
  }

  send(msg: ClientMsg): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  sendInput(f: InputFrame): void {
    if (this.connected) this.ws!.send(encodeInput(f));
  }
}
