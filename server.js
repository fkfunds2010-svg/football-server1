const { defineServer, Room } = require("colyseus");
const { Schema, MapSchema } = require("@colyseus/schema");
const { playground } = require("@colyseus/playground");
const cors = require("cors");
const express = require("express");
const path = require("path");

let lastCrash = '';
process.on('uncaughtException', (err) => {
  lastCrash = err.stack || err.message;
  console.error(lastCrash);
});
process.on('unhandledRejection', (reason) => {
  lastCrash = reason?.stack || reason?.message || String(reason);
  console.error(lastCrash);
});

// ---------- Schemas ----------
class PlayerState extends Schema {
  constructor() {
    super();
    this.x = 150; this.y = 415; this.vx = 0; this.vy = 0;
    this.isJumping = false; this.color = "#ff00ff"; this.side = "left";
    this.name = ""; this.ready = false; this.accelX = 0;
    this.reconnecting = false; this.disconnectTime = 0;
  }
}
PlayerState._schema = {
  x: "number", y: "number", vx: "number", vy: "number",
  isJumping: "boolean", color: "string", side: "string",
  name: "string", ready: "boolean", accelX: "number",
  reconnecting: "boolean", disconnectTime: "number"
};

class BallState extends Schema {
  constructor() { super(); this.x = 500; this.y = 250; this.vx = 5; this.vy = -3; }
}
BallState._schema = { x: "number", y: "number", vx: "number", vy: "number" };

class KeeperState extends Schema {
  constructor() { super(); this.y = 250; this.vy = 0; }
}
KeeperState._schema = { y: "number", vy: "number" };

class GameState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.ball = new BallState();
    this.keeper1 = new KeeperState();
    this.keeper2 = new KeeperState();
    this.p1Score = 0; this.p2Score = 0; this.timeLeft = 120;
    this.gameOver = false; this.winnerMessage = "";
    this.matchState = "waiting"; this.hostId = ""; this.roomCode = "";
    this.countdown = -1; this.goalFreeze = 0;
    this.password = ""; this.lastWinner = "";
  }
}
GameState._schema = {
  players: { map: PlayerState },
  ball: BallState, keeper1: KeeperState, keeper2: KeeperState,
  p1Score: "number", p2Score: "number", timeLeft: "number",
  gameOver: "boolean", winnerMessage: "string",
  matchState: "string", hostId: "string", roomCode: "string",
  countdown: "number", goalFreeze: "number",
  password: "string", lastWinner: "string"
};

// ---------- Room (Step 4 – added move handler + full onJoin) ----------
class FootballRoom extends Room {
  constructor() {
    super();
    this.maxClients = 2;
    this.state = new GameState();
    this.inputs = {};
    this.targetGoals = 10;
    this.reconnectTimers = {};
  }

  static onAuth(client, options, request) { return true; }

  onError(err) {
    lastCrash = `ROOM ERROR: ${err.stack || err.message}`;
    console.error(lastCrash);
  }

  onCreate(options) {
    this.state.roomCode = this.roomId;
    this.state.password = options.password || Math.random().toString(36).substr(2, 6);

    // setName
    this.onMessage("setName", (client, name) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.name = name;
      this.broadcastPlayerInfo();
    });

    // ready
    this.onMessage("ready", (client) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.ready = !p.ready;
      this.broadcastPlayerInfo();
      if (this.state.players.size === 2 && [...this.state.players.values()].every(pl => pl.ready)) {
        this.state.matchState = "ready_check";
        this.startCountdown();
      }
    });

    // ✅ NEW: move handler
    this.onMessage("move", (client, input) => {
      if (typeof input === "object") {
        this.inputs[client.sessionId] = {
          left: !!input.left, right: !!input.right, up: !!input.up, down: !!input.down,
          shoot: !!input.shoot, turbo: !!input.turbo
        };
      }
    });

    this.setSimulationInterval((dt) => {
      try { this.gameTick(); } catch (e) { lastCrash = e.message; console.error(e); }
    }, 1000 / 30);
  }

  // ✅ NEW: full onJoin with reconnection logic
  onJoin(client, options) {
    const ep = this.state.players.get(client.sessionId);
    if (ep) {
      ep.reconnecting = false;
      if (this.reconnectTimers[client.sessionId]) {
        clearTimeout(this.reconnectTimers[client.sessionId]);
        delete this.reconnectTimers[client.sessionId];
      }
      this.broadcast("playerReconnected", {});
      this.broadcastPlayerInfo();
      return;
    }
    if (this.clients.length >= 2) {
      client.send("error", { message: "Room is full" });
      client.leave();
      return;
    }
    const player = new PlayerState();
    const isP1 = this.clients.length === 1;
    if (isP1) this.state.hostId = client.sessionId;
    player.x = isP1 ? 150 : 820;
    player.y = 415;
    player.color = isP1 ? "#ff00ff" : "#00f2ff";
    player.side = isP1 ? "left" : "right";
    this.state.players.set(client.sessionId, player);
    setTimeout(() => this.broadcastPlayerInfo(), 200);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
  }

  broadcastPlayerInfo() {
    const p1 = [...this.state.players.values()].find(p => p.side === "left");
    const p2 = [...this.state.players.values()].find(p => p.side === "right");
    this.broadcast("playerNames", {
      p1: p1?.name || "—", p2: p2?.name || "—",
      p1Ready: p1?.ready || false, p2Ready: p2?.ready || false,
      password: this.state.password
    });
  }

  startCountdown() {
    this.state.matchState = "countdown";
    this.state.countdown = 3;
    this.broadcast("countdown", { value: this.state.countdown });
    const interval = setInterval(() => {
      if (this.state.matchState !== "countdown") { clearInterval(interval); return; }
      this.state.countdown--;
      if (this.state.countdown <= 0) {
        clearInterval(interval);
        this.state.matchState = "live";
        this.broadcast("gameStarted");
        this.broadcast("event", { type: "MUSIC_NEXT" });
      } else {
        this.broadcast("countdown", { value: this.state.countdown });
      }
    }, 1000);
  }

  gameTick() {
    // ... (your full gameTick, unchanged from Step 3) ...
  }
}

// ==================== SERVER SETUP ====================
const server = defineServer({
  rooms: { football: FootballRoom },
  reservationTimeInSeconds: 60,
  express: (app) => {
    app.use((req, res, next) => {
      if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') return;
      next();
    });
    app.set("trust proxy", 1);
    app.use(cors());
    app.use(express.json());
    app.get("/health", (req, res) => res.send("OK"));
    app.use("/playground", playground());
    app.use((req, res, next) => {
      res.removeHeader("Content-Security-Policy");
      res.setHeader("Content-Security-Policy", "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data:; connect-src * ws: wss:;");
      next();
    });
    app.get("/crash", (req, res) => res.type("text/plain").send(lastCrash));
    app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
  }
});

const PORT = Number(process.env.PORT) || 2567;
server.listen(PORT, () => console.log(`⚡ Server on port ${PORT}`));
