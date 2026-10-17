import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { decodeSnapshot, encodeInput, isSnapshotFrame, type ServerMsg, type Snapshot } from "@rr/shared";
import { GameServer } from "../src/server.ts";

let server: GameServer;
let port = 0;

beforeAll(async () => {
  server = new GameServer({ port: 0 });
  port = await server.listen();
});
afterAll(() => server.close());

/** A scripted test client. */
class Bot {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  snaps: Snapshot[] = [];
  private waiters: (() => void)[] = [];
  constructor() {
    this.ws = new WebSocket(`ws://localhost:${port}/ws`);
    this.ws.on("message", (data, binary) => {
      if (binary) {
        const b = new Uint8Array(data as Buffer);
        if (isSnapshotFrame(b)) this.snaps.push(decodeSnapshot(b));
      } else this.msgs.push(JSON.parse(data.toString()));
      this.waiters.splice(0).forEach((w) => w());
    });
  }
  open() {
    return new Promise<void>((r) => this.ws.once("open", () => r()));
  }
  send(m: object) {
    this.ws.send(JSON.stringify(m));
  }
  async waitFor<T extends ServerMsg["t"]>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, ms = 3000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const m = this.msgs.find((x) => x.t === t && pred(x as Extract<ServerMsg, { t: T }>));
      if (m) return m as Extract<ServerMsg, { t: T }>;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${t}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }
}

describe("server", () => {
  it("private race: create, join by code, start, ride", async () => {
    const a = new Bot();
    const b = new Bot();
    await Promise.all([a.open(), b.open()]);
    a.send({ t: "hello", name: "Alice", colour: 0xff0000 });
    b.send({ t: "hello", name: "Bob<script>", colour: 0xff0000 });
    a.send({ t: "create" });
    const room = (await a.waitFor("room")).room;
    expect(room.public).toBe(false);
    b.send({ t: "join", code: room.code.toUpperCase() });
    const joined = await b.waitFor("room", (m) => m.room.players.length === 2);
    expect(joined.room.players.map((p) => p.name)).toEqual(["Alice", "Bobscript"]);
    // Colours are de-duplicated.
    expect(joined.room.players[0].colour).not.toBe(joined.room.players[1].colour);

    // Only the host may start a private race.
    b.send({ t: "start" });
    await new Promise((r) => setTimeout(r, 150));
    expect(a.msgs.some((m) => m.t === "start")).toBe(false);
    a.send({ t: "start" });
    const start = await a.waitFor("start");
    expect(start.entries).toHaveLength(12);
    expect(start.entries[start.riderId].name).toBe("Alice");

    // Alice holds the throttle through the countdown and a few seconds of racing.
    let seq = 0;
    const timer = setInterval(() => {
      seq++;
      a.ws.send(encodeInput({ seq, viewTick: 0, input: { throttle: 1, brake: 0, steer: 0, attack: 0, attackSide: 1 } }));
    }, 1000 / 60);
    await new Promise((r) => setTimeout(r, 4500));
    clearInterval(timer);

    const last = a.snaps[a.snaps.length - 1];
    expect(a.snaps.length).toBeGreaterThan(80);
    expect(last.phase).toBe("racing");
    expect(last.ackSeq).toBeGreaterThan(seq - 10);
    const alice = last.riders[start.riderId];
    expect(alice.human).toBe(true);
    expect(alice.speed).toBeGreaterThan(10);
    expect(last.events.length + a.snaps.reduce((n, s) => n + s.events.length, 0)).toBeGreaterThan(0);

    // Bob leaving mid-race hands his bike to the AI.
    const bobId = (await b.waitFor("start")).riderId;
    b.ws.close();
    await new Promise((r) => setTimeout(r, 300));
    const after = a.snaps[a.snaps.length - 1];
    expect(after.riders[bobId].human).toBe(false);
    a.ws.close();
  }, 15000);

  it("quick play groups players into one public lobby", async () => {
    const bots = [new Bot(), new Bot(), new Bot()];
    await Promise.all(bots.map((b) => b.open()));
    for (const b of bots) {
      b.send({ t: "hello", name: "Q", colour: 1 });
      b.send({ t: "quick" });
    }
    const rooms = await Promise.all(bots.map((b) => b.waitFor("room", (m) => m.room.players.length === 3)));
    expect(new Set(rooms.map((r) => r.room.code)).size).toBe(1);
    expect(rooms[0].room.public).toBe(true);
    expect(rooms[0].room.startsAt).toBeGreaterThan(Date.now());
    bots.forEach((b) => b.ws.close());
  });

  it("goes to results when every human finishes, then back to the lobby", async () => {
    const a = new Bot();
    await a.open();
    a.send({ t: "hello", name: "Fin", colour: 2 });
    a.send({ t: "create" });
    const code = (await a.waitFor("room")).room.code;
    a.send({ t: "start" });
    const start = await a.waitFor("start");
    const room = server.rooms.get(code)!;
    room.race!.riders[start.riderId].finished = true;
    const results = await a.waitFor("room", (m) => m.room.state === "results");
    expect(results.room.code).toBe(code);
    const lobby = await a.waitFor("room", (m) => m.room.state === "lobby" && a.msgs.indexOf(m) > a.msgs.indexOf(results), 12000);
    expect(lobby.room.players).toHaveLength(1);
    a.ws.close();
  }, 20000);

  it("rejects unknown codes", async () => {
    const c = new Bot();
    await c.open();
    c.send({ t: "join", code: "zzzzz" });
    expect((await c.waitFor("error")).message).toMatch(/doesn't exist/);
    c.ws.close();
  });
});
