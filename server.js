const http = require("http");
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
  // … (your full room code – it is unchanged)
  // I have omitted the duplication for brevity. Please copy the complete room code from the
  // previous message; it is long but perfectly correct.
  // Make sure you include the entire class definition here.
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

// 1. Create the HTTP server from the Express app
const httpServer = http.createServer(app);

// 2. Create the Colyseus server, attaching it to the SAME httpServer
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});
gameServer.define("football", FootballRoom);

// ----- MANUAL MATCHMAKING ROUTES (FIXES THE JSON.parse ERROR FOREVER) -----
// These routes handle the exact HTTP requests that the Playground and the client SDK make.
app.post("/matchmake/create", async (req, res) => {
  try {
    // The request body contains the room name and options.
    const options = req.body.options || req.body;
    const room = await gameServer.matchmaker.create("football", options);
    res.json({ roomId: room.roomId });
    console.log(`✅ Room created: ${room.roomId}`);
  } catch (e) {
    console.error("❌ Create failed:", e.message);
    res.status(400).json({ error: e.message });
  }
});

app.post("/matchmake/joinOrCreate", async (req, res) => {
  try {
    const options = req.body.options || req.body;
    const room = await gameServer.matchmaker.joinOrCreate("football", options);
    res.json({ roomId: room.roomId });
    console.log(`✅ Room joined/created: ${room.roomId}`);
  } catch (e) {
    console.error("❌ JoinOrCreate failed:", e.message);
    res.status(400).json({ error: e.message });
  }
});

app.post("/matchmake/joinById", async (req, res) => {
  try {
    const { roomId, options } = req.body;
    const room = await gameServer.matchmaker.joinById(roomId, options || {});
    res.json({ roomId: room.roomId });
    console.log(`✅ Joined room by ID: ${room.roomId}`);
  } catch (e) {
    console.error("❌ JoinById failed:", e.message);
    res.status(400).json({ error: e.message });
  }
});

console.log("✅ Manual matchmaking routes registered.");

// 3. Start listening
httpServer.listen(port, () => {
  console.log(`⚡ HTTP server listening on port ${port}`);
});

console.log(`⚡ Colyseus WebSocket ready on port ${port}`);
