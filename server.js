const http = require("http");
const { defineServer, Room } = require("colyseus");
const { Schema, MapSchema } = require("@colyseus/schema");
const { playground } = require("@colyseus/playground");
const cors = require("cors");
const express = require("express");

// ---------- Prevent crashes ----------
process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (reason) => console.error('Unhandled:', reason));

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

// ---------- Room (unchanged game logic) ----------
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

  onCreate(options) {
    this.state.roomCode = this.roomId;
    this.state.password = options.password || Math.random().toString(36).substr(2, 6);

    this.onMessage("setName", (client, name) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.name = name;
      this.broadcastPlayerInfo();
    });

    this.onMessage("ready", (client) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.ready = !p.ready;
      this.broadcastPlayerInfo();
      if (this.state.players.size === 2 && [...this.state.players.values()].every(pl => pl.ready)) {
        this.state.matchState = "ready_check";
        this.startCountdown();
      }
    });

    this.onMessage("move", (client, input) => {
      if (typeof input === "object") {
        this.inputs[client.sessionId] = {
          left: !!input.left, right: !!input.right, up: !!input.up, down: !!input.down,
          shoot: !!input.shoot, turbo: !!input.turbo
        };
      }
    });

    this.onMessage("chat", (client, msg) => {
      const s = this.state.players.get(client.sessionId)?.name || "Unknown";
      this.broadcast("chat", { sender: s, text: (msg || "").substring(0, 200) });
    });

    this.onMessage("emote", (client, em) => {
      const p = this.state.players.get(client.sessionId);
      if (p) this.broadcast("emote", { playerName: p.name, emoteId: em });
    });

    this.onMessage("ping", (client, d) => client.send("pong", d));

    this.onMessage("rematch", (client) => {
      if (this.state.matchState !== "end") return;
      this.state.players.forEach(p => {
        p.x = p.side === "left" ? 150 : 820; p.y = 415; p.vx = 0; p.vy = 0;
        p.isJumping = false; p.ready = false;
      });
      this.state.ball.x = 500; this.state.ball.y = 250;
      this.state.ball.vx = 5; this.state.ball.vy = -3;
      this.state.p1Score = 0; this.state.p2Score = 0;
      this.state.timeLeft = 120;
      this.state.gameOver = false; this.state.winnerMessage = "";
      this.state.matchState = "waiting"; this.state.countdown = -1;
      this.state.goalFreeze = 0;
      this.broadcast("rematch");
      this.broadcastPlayerInfo();
    });

    this.setSimulationInterval((dt) => {
      try { this.gameTick(); } catch (e) { console.error("gameTick error:", e.message); }
    }, 1000 / 30);
  }

  onJoin(client, options) {
    const pass = options?.password;
    if (pass && pass !== this.state.password) {
      client.send("error", { message: "Incorrect password" });
      client.leave();
      return;
    }
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
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    player.reconnecting = true;
    player.disconnectTime = Date.now();
    this.broadcast("opponentReconnecting", { sessionId: client.sessionId });
    this.reconnectTimers[client.sessionId] = setTimeout(() => {
      if (player.reconnecting) {
        this.state.players.delete(client.sessionId);
        this.broadcastPlayerInfo();
        this.broadcast("playerLeft", {});
      }
    }, 30000);
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
    // ... (full game tick logic unchanged – same as before)
  }
}

// ==================== EXPRESS APP (HTTP only) ====================
const app = express();

app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

app.options('*', cors());

app.get("/health", (req, res) => res.send("OK"));

app.use("/playground", playground());

app.use((req, res, next) => {
  res.removeHeader("Content-Security-Policy");
  res.setHeader(
    "Content-Security-Policy",
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data:; connect-src * ws: wss:;"
  );
  next();
});

app.use(express.static("public"));

// ==================== COLYSEUS SERVER ====================
const httpServer = http.createServer(app);

const gameServer = defineServer({
  server: httpServer,
  rooms: { football: FootballRoom },
});

const PORT = Number(process.env.PORT) || 2567;
httpServer.listen(PORT, () => {
  console.log(`⚡ Server listening on port ${PORT}`);
});
