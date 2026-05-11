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

// ---------- Room (bare minimum) ----------
class FootballRoom extends Room {
  constructor() {
    super();
    this.maxClients = 2;
    this.state = new GameState();
  }

  static onAuth(client, options, request) { return true; }

  onError(err) {
    lastCrash = `ROOM ERROR: ${err.stack || err.message}`;
    console.error(lastCrash);
  }

  onCreate(options) {
    this.state.roomCode = this.roomId;
    this.state.password = options.password || Math.random().toString(36).substr(2, 6);
  }

  onJoin(client, options) {
    const player = new PlayerState();
    const isP1 = this.clients.length === 1;
    player.x = isP1 ? 150 : 820;
    player.y = 415;
    player.color = isP1 ? "#ff00ff" : "#00f2ff";
    player.side = isP1 ? "left" : "right";
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
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
