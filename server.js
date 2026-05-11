const { defineServer, Room } = require("colyseus");
const { Schema, MapSchema } = require("@colyseus/schema");
const { playground } = require("@colyseus/playground");
const cors = require("cors");
const express = require("express");
const path = require("path");

// ⚡ Crash logger – catches EVERYTHING
let lastCrash = 'No crash recorded yet.';
process.on('uncaughtException', (err) => {
  lastCrash = `UNCAUGHT EXCEPTION: ${err.stack || err.message}`;
  console.error(lastCrash);
});
process.on('unhandledRejection', (reason, promise) => {
  lastCrash = `UNHANDLED REJECTION: ${reason?.stack || reason?.message || reason}`;
  console.error(lastCrash);
});

// ---------- Schemas (bare minimum for the room to start) ----------
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

// ---------- Room (simplified, but will catch any crash) ----------
class FootballRoom extends Room {
  constructor() {
    super();
    this.maxClients = 2;
    this.state = new GameState();
  }

  static onAuth(client, options, request) { return true; }

  // ⚡ Colyseus internal error handler – catches room crashes
  onError(err) {
    lastCrash = `ROOM ERROR: ${err.stack || err.message}`;
    console.error(lastCrash);
  }

  onCreate(options) {
    try {
      this.state.roomCode = this.roomId;
      this.state.password = options.password || Math.random().toString(36).substr(2, 6);
      // Set up a simple message handler
      this.onMessage("ping", (client, d) => client.send("pong", d));
      // Do NOT start any simulation interval – we want the room to live just long enough to reveal the crash
      console.log(`Room ${this.roomId} created – waiting for join to trigger crash`);
    } catch (e) {
      lastCrash = `onCreate crashed: ${e.stack || e.message}`;
      console.error(lastCrash);
    }
  }

  onJoin(client, options) {
    try {
      console.log(`onJoin called, sessionId=${client.sessionId}`);
      // Quick re-join check
      const ep = this.state.players.get(client.sessionId);
      if (ep) {
        ep.reconnecting = false;
        return;
      }
      if (this.clients.length >= 2) {
        client.send("error", { message: "Room is full" });
        client.leave();
        return;
      }
      // Add a player – keep it simple
      const player = new PlayerState();
      const isP1 = this.clients.length === 1;
      player.x = isP1 ? 150 : 820;
      player.y = 415;
      player.color = isP1 ? "#ff00ff" : "#00f2ff";
      player.side = isP1 ? "left" : "right";
      this.state.players.set(client.sessionId, player);
      console.log(`Player added. Total: ${this.state.players.size}`);
    } catch (e) {
      lastCrash = `onJoin crashed: ${e.stack || e.message}`;
      console.error(lastCrash);
    }
  }

  onLeave(client) {
    const player = this.state.players.get(client.sessionId);
    if (player) this.state.players.delete(client.sessionId);
  }
}

// ==================== SERVER SETUP ====================
const server = defineServer({
  rooms: { football: FootballRoom },
  reservationTimeInSeconds: 60,
  express: (app) => {
    // WebSocket passthrough
    app.use((req, res, next) => {
      if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
        return;
      }
      next();
    });

    app.set("trust proxy", 1);
    app.use(cors());
    app.use(express.json());

    app.get("/health", (req, res) => res.send("OK"));
    app.use("/playground", playground());

    // Permissive CSP
    app.use((req, res, next) => {
      res.removeHeader("Content-Security-Policy");
      res.setHeader("Content-Security-Policy", "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data:; connect-src * ws: wss:;");
      next();
    });

    // ✅ Crash log page – shows the exact error
    app.get("/crash", (req, res) => {
      res.type("text/plain").send(lastCrash);
    });

    app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
  }
});

const PORT = Number(process.env.PORT) || 2567;
server.listen(PORT, () => console.log(`⚡ Server on port ${PORT}`));
