const { Server, Room } = require("@colyseus/core");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { Schema, MapSchema } = require("@colyseus/schema");
const express = require("express");
const cors = require("cors");
const { playground } = require("@colyseus/playground");

// ---------- Schemas ----------
class PlayerState extends Schema {
  constructor() {
    super();
    this.x = 150; this.y = 415; this.vx = 0; this.vy = 0;
    this.isJumping = false; this.color = "#ff00ff"; this.side = "left";
    this.name = ""; this.ready = false; this.accelX = 0;
    this.reconnecting = false;
    this.disconnectTime = 0;
  }
}
PlayerState._schema = {
  x: "number", y: "number", vx: "number", vy: "number",
  isJumping: "boolean", color: "string", side: "string",
  name: "string", ready: "boolean", accelX: "number",
  reconnecting: "boolean",
  disconnectTime: "number"
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
    this.matchState = "waiting";
    this.hostId = ""; this.roomCode = "";
    this.countdown = -1; this.goalFreeze = 0;
    this.password = ""; this.lastWinner = "";
  }
}
GameState._schema = {
  players: { map: PlayerState },
  ball: BallState,
  keeper1: KeeperState, keeper2: KeeperState,
  p1Score: "number", p2Score: "number", timeLeft: "number",
  gameOver: "boolean", winnerMessage: "string",
  matchState: "string", hostId: "string", roomCode: "string",
  countdown: "number", goalFreeze: "number",
  password: "string", lastWinner: "string"
};

// ---------- Room ----------
class FootballRoom extends Room {
  // … (the entire FootballRoom class stays exactly as in your last working version)
  // I’ve removed the duplicate here for brevity, but keep your full class.
}

// ---------- Express & Colyseus server ----------
const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

app.get("/", (_, res) => res.send("Football server is running ✅"));
app.get("/health", (_, res) => res.send("OK"));

app.use("/playground", playground());

const port = process.env.PORT || 2567;
const httpServer = app.listen(port, () => {
  console.log(`⚡ HTTP server listening on port ${port}`);
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});
gameServer.define("football", FootballRoom);

// ---------- Matchmaking routes (manual fallback) ----------
// This replaces the broken `matchMaker.express()` / `exposeRoutes()` calls.
// It uses the internal matchmaker reference to handle /matchmake/* requests.
const matchmaker = gameServer.matchmaker;

if (matchmaker && matchmaker.create) {
  // /matchmake/create
  app.post("/matchmake/create", (req, res) => {
    try {
      const options = req.body;
      matchmaker.create("football", options).then(room => {
        res.json({ roomId: room.roomId, sessionId: "" });
      }).catch(err => {
        res.status(500).json({ error: err.message });
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // /matchmake/joinOrCreate
  app.post("/matchmake/joinOrCreate", (req, res) => {
    try {
      const options = req.body;
      matchmaker.joinOrCreate("football", options).then(room => {
        res.json({ roomId: room.roomId, sessionId: "" });
      }).catch(err => {
        res.status(500).json({ error: err.message });
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // /matchmake/joinById
  app.post("/matchmake/joinById", (req, res) => {
    try {
      const { roomId, ...options } = req.body;
      matchmaker.joinById(roomId, options).then(room => {
        res.json({ roomId: room.roomId, sessionId: "" });
      }).catch(err => {
        res.status(500).json({ error: err.message });
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  console.log("✅ Manual matchmaking routes registered.");
} else {
  console.warn("⚠️ Matchmaker not available – falling back to built‑in intercept.");
  // If the matchmaker reference is undefined, Colyseus will automatically
  // intercept the POST requests because WebSocketTransport is attached.
}

console.log(`⚡ Colyseus WebSocket ready on port ${port}`);
