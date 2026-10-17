import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { createGzip } from "node:zlib";
import { WebSocketServer } from "ws";
import { INPUT_FRAME_BYTES, decodeInput, idleInput, isInputFrame, type ClientMsg } from "@rr/shared";
import { Conn } from "./conn.ts";
import { Room, type Player } from "./room.ts";

export interface ServerOptions {
  port: number;
  /** Simulated round-trip latency, for testing netcode locally. */
  lagMs?: number;
  jitterMs?: number;
  /** Built client to serve in production. */
  staticDir?: string;
}

const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

export class GameServer {
  readonly rooms = new Map<string, Room>();
  readonly http: Server;
  private nextId = 1;

  constructor(private readonly opts: ServerOptions) {
    this.http = createServer((req, res) => {
      if (req.url === "/health") {
        res.end(JSON.stringify({ ok: true, rooms: this.rooms.size }));
        return;
      }
      const dir = opts.staticDir;
      if (!dir) {
        res.statusCode = 404;
        res.end();
        return;
      }
      // Single-page app: unknown paths (like /r/abc12) get index.html.
      const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
      let file = normalize(join(dir, url));
      if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = join(dir, "index.html");
      res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
      // Vite fingerprints everything under /assets, so those can be cached forever.
      res.setHeader("cache-control", url.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
      const ext = extname(file);
      if ((ext === ".js" || ext === ".css" || ext === ".html") && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
        res.setHeader("content-encoding", "gzip");
        res.setHeader("vary", "accept-encoding");
        createReadStream(file).pipe(createGzip()).pipe(res);
      } else createReadStream(file).pipe(res);
    });
    // Real messages are tiny; refuse anything big before it is buffered.
    const wss = new WebSocketServer({ server: this.http, path: "/ws", maxPayload: 4096 });
    wss.on("connection", (ws) => this.connect(new Conn(ws, opts.lagMs ?? 0, opts.jitterMs ?? 0)));
  }

  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(this.opts.port, () => {
        const a = this.http.address();
        resolve(typeof a === "object" && a ? a.port : this.opts.port);
      });
    });
  }

  close(): void {
    for (const r of [...this.rooms.values()]) r.destroy();
    this.http.closeAllConnections?.();
    this.http.close();
  }

  private newCode(): string {
    let code = "";
    do {
      code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
    } while (this.rooms.has(code));
    return code;
  }

  private createRoom(isPublic: boolean): Room {
    const room = new Room(this.newCode(), isPublic, (r) => this.rooms.delete(r.code));
    this.rooms.set(room.code, room);
    return room;
  }

  /** Quick play: the public lobby closest to full, or a fresh one. */
  private quickRoom(): Room {
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (!r.isPublic || !r.joinable) continue;
      if (!best || r.humans > best.humans) best = r;
    }
    return best ?? this.createRoom(true);
  }

  private connect(conn: Conn): void {
    const player: Player = {
      id: this.nextId++,
      name: "Rider",
      colour: 0xe8402a,
      conn,
      room: null,
      riderId: -1,
      inputs: [],
      last: idleInput(),
      ackSeq: 0,
      viewTick: 0,
      connected: true,
    };
    conn.send({ t: "welcome", playerId: player.id });

    // Everything a client sends is untrusted: malformed messages are dropped, never thrown.
    conn.onMessage((data, binary) => {
      try {
        if (binary) {
          const bytes = new Uint8Array(data as Buffer);
          if (bytes.length === INPUT_FRAME_BYTES && isInputFrame(bytes) && player.room) player.room.receiveInput(player, decodeInput(bytes));
          return;
        }
        const msg = JSON.parse(data as string) as ClientMsg;
        if (msg && typeof msg === "object" && typeof msg.t === "string") this.handle(player, msg);
      } catch (e) {
        console.warn(`dropped bad message from player ${player.id}:`, (e as Error).message);
      }
    });
    conn.onClose(() => {
      player.connected = false;
      player.room?.remove(player);
    });
  }

  private handle(p: Player, msg: ClientMsg): void {
    switch (msg.t) {
      case "hello":
        p.name = String(msg.name ?? "Rider").replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 14) || "Rider";
        if (typeof msg.colour === "number") p.colour = msg.colour & 0xffffff;
        break;
      case "quick":
        p.room?.remove(p);
        this.quickRoom().add(p);
        break;
      case "create":
        p.room?.remove(p);
        this.createRoom(false).add(p);
        break;
      case "join": {
        const room = this.rooms.get(String(msg.code).toLowerCase());
        if (!room) {
          p.conn.send({ t: "error", message: "That race doesn't exist any more." });
          return;
        }
        if (!room.joinable) {
          p.conn.send({ t: "error", message: room.state === "lobby" ? "That race is full." : "That race is already under way. Try again when it finishes." });
          return;
        }
        p.room?.remove(p);
        room.add(p);
        break;
      }
      case "start":
        p.room?.requestStart(p);
        break;
      case "leave":
        p.room?.remove(p);
        p.conn.send({ t: "left" });
        break;
      case "ping":
        p.conn.send({ t: "pong", at: msg.at, serverTick: p.room?.race?.tick ?? 0 });
        break;
      case "ready":
        break;
    }
  }
}
