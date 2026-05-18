const { defineServer, Room } = require("colyseus");
const { Schema, MapSchema, defineTypes } = require("@colyseus/schema");
const { playground } = require("@colyseus/playground");
const cors = require("cors");
const express = require("express");
const path = require("path");

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
    this.countdown = -1;
    this.password = ""; this.lastWinner = "";
  }
}
GameState._schema = {
  players: { map: PlayerState },
  ball: BallState, keeper1: KeeperState, keeper2: KeeperState,
  p1Score: "number", p2Score: "number", timeLeft: "number",
  gameOver: "boolean", winnerMessage: "string",
  matchState: "string", hostId: "string", roomCode: "string",
  countdown: "number",
  password: "string", lastWinner: "string"
};

defineTypes(PlayerState, PlayerState._schema);
defineTypes(BallState, BallState._schema);
defineTypes(KeeperState, KeeperState._schema);
defineTypes(GameState, GameState._schema);

// ---------- Room ----------
class FootballRoom extends Room {
  constructor() {
    super();
    this.maxClients = 2;
    this.state = new GameState();
    this.inputs = {};
    this.reconnectTimers = {};
  }

  static onAuth(client, options, request) { return true; }

  onCreate(options) {
    this.state.roomCode = this.roomId;
    this.state.password = options.password || Math.random().toString(36).substr(2, 6);

    const minutes = options.matchTime || 2;
    const goals = options.targetGoals || 10;
    this.state.timeLeft = minutes * 60;
    this.targetGoals = goals;

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
          left: !!input.left,
          right: !!input.right,
          up: !!input.up,
          down: !!input.down,
          shoot: !!input.shoot,
          turbo: !!input.turbo,
          aimAngle: input.aimAngle
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

    // ✅ Allow host to change match settings during lobby
    this.onMessage("setMatchOptions", (client, opts) => {
      if (this.state.matchState !== "waiting" && this.state.matchState !== "ready_check") return;
      const p = this.state.players.get(client.sessionId);
      if (!p || p.side !== "left") return;   // only host
      if (typeof opts.matchTime === "number" && opts.matchTime > 0) {
        this.state.timeLeft = opts.matchTime * 60;
      }
      if (typeof opts.targetGoals === "number" && opts.targetGoals > 0) {
        this.targetGoals = opts.targetGoals;
      }
      this.broadcast("matchOptionsUpdated", {
        timeLeft: this.state.timeLeft,
        targetGoals: this.targetGoals
      });
    });

    this.onMessage("rematch", (client) => {
      if (this.state.matchState !== "end") return;
      this.state.players.forEach(p => {
        p.x = p.side === "left" ? 150 : 820; p.y = 415; p.vx = 0; p.vy = 0;
        p.isJumping = false; p.ready = false;
      });
      this.state.ball.x = 500; this.state.ball.y = 250;
      this.state.ball.vx = 5; this.state.ball.vy = -3;
      this.state.p1Score = 0; this.state.p2Score = 0;
      this.state.timeLeft = minutes * 60;
      this.state.gameOver = false; this.state.winnerMessage = "";
      this.state.matchState = "waiting"; this.state.countdown = -1;
      this.broadcast("rematch");
      this.broadcastPlayerInfo();
    });

    this.setSimulationInterval((dt) => {
      try { this.gameTick(); } catch (e) { console.error("gameTick error:", e.message); }
    }, 1000 / 60);
  }

  onJoin(client, options) {
    const player = new PlayerState();
    const isP1 = this.clients.length === 1;
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
    if (this.state.matchState !== "live" || this.state.gameOver || this.state.players.size < 2) return;

    const FIXED_DT = 1 / 30;
    const ball = this.state.ball;

    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vy += 0.25;
    ball.vx *= 0.995;
    if (ball.y > 480) { ball.y = 480; ball.vy *= -0.7; }
    if (ball.y < 10)  { ball.y = 10;  ball.vy *= -0.7; }

    [{ x: 5, k: this.state.keeper1 }, { x: 983, k: this.state.keeper2 }].forEach(({ x: kx, k }) => {
      if (ball.x + 10 > kx && ball.x - 10 < kx + 12 && ball.y + 10 > k.y && ball.y - 10 < k.y + 60) {
        if (Math.abs(ball.vx) > 25) this.broadcast("event", { type: "SHOT", data: { turbo: false, color: "#fff" } });
        ball.vx *= -1.1;
        ball.x = (kx < 500) ? 25 : 970;
      }
    });

    this.state.players.forEach(p => {
      if (ball.x + 10 > p.x && ball.x - 10 < p.x + 30 && ball.y + 10 > p.y && ball.y - 10 < p.y + 65) {
        ball.vx *= -0.5;
        ball.x = (ball.x < p.x + 15) ? p.x - 11 : p.x + 31;
      }
    });

    if (ball.x < 0 || ball.x > 1000) {
      if (ball.y > 150 && ball.y < 350) {
        if (ball.x < 0) this.state.p2Score++; else this.state.p1Score++;
        this.broadcast("event", { type: "GOAL", data: { scorer: ball.x < 0 ? "p2" : "p1", color: ball.x < 0 ? "#00f2ff" : "#ff00ff" } });
        ball.x = 500; ball.y = 250; ball.vx = (Math.random() > 0.5 ? 5 : -5); ball.vy = -3;
        if (this.state.p1Score >= this.targetGoals || this.state.p2Score >= this.targetGoals) {
          this.state.gameOver = true; this.state.matchState = "end";
          this.state.winnerMessage = this.state.p1Score >= this.targetGoals ? "Player 1 Wins!" : "Player 2 Wins!";
          this.state.lastWinner = this.state.p1Score >= this.targetGoals ? "p1" : "p2";
        }
      } else { ball.vx *= -1; ball.x = ball.x < 0 ? 5 : 995; }
    }

    this.state.players.forEach((player, sid) => {
      const input = this.inputs[sid] || {};
      const dx = player.x + 15 - ball.x, dy = player.y + 32 - ball.y;
      const hasBall = dx * dx + dy * dy < 2500;

      if (hasBall && input.shoot) {
        player.vx = 0;
        let speed = input.turbo ? 45 : 20;

        if (typeof input.aimAngle === 'number') {
          const rad = input.aimAngle * Math.PI / 180;
          const dirX = Math.cos(rad);
          const dirY = -Math.sin(rad);
          ball.vx = dirX * speed;
          ball.vy = dirY * speed;
        } else {
          ball.vx = (player.side === 'left') ? speed : -speed;
          if (input.up && !input.down) ball.vy = -14;
          else if (input.down) ball.vy = 10;
          else ball.vy = -2;
        }

        this.broadcast("event", { type: "SHOT", data: { turbo: input.turbo, color: player.color } });
      } else {
        if (input.left) player.vx -= 1.1;
        if (input.right) player.vx += 1.1;
        if (input.up && !player.isJumping) {
          player.vy = -14;
          player.isJumping = true;
        }
        if (input.down) player.vy += 1;
      }

      player.vy += 0.7;
      player.x += player.vx;
      player.y += player.vy;
      player.vx *= 0.85;
      if (player.y > 415) { player.y = 415; player.vy = 0; player.isJumping = false; }
      player.x = Math.min(930, Math.max(40, player.x));
    });

    const targetY = ball.y - 30;
    [this.state.keeper1, this.state.keeper2].forEach((k, i) => {
      const skill = (i === 0) ? 1.2 : 1.0;
      k.vy += (targetY - k.y) * 0.1 * skill;
      k.vy *= 0.7;
      k.y += k.vy;
      k.y = Math.min(295, Math.max(155, k.y));
    });

    if (this.state.timeLeft > 0) {
      this.state.timeLeft -= FIXED_DT;
      if (this.state.timeLeft <= 0) {
        this.state.gameOver = true; this.state.matchState = "end";
        this.state.winnerMessage = this.state.p1Score > this.state.p2Score ? "Player 1 Wins!" : (this.state.p2Score > this.state.p1Score ? "Player 2 Wins!" : "Draw!");
        this.state.lastWinner = this.state.p1Score > this.state.p2Score ? "p1" : (this.state.p2Score > this.state.p1Score ? "p2" : "draw");
      }
    }
  }
}

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
    app.get("/schema.js", (req, res) => {
      res.type("application/javascript");
      res.sendFile(path.join(__dirname, "node_modules", "@colyseus", "schema", "build", "index.js"));
    });
    app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
    app.use(express.static("public", { index: false }));
  }
});

const PORT = Number(process.env.PORT) || 2567;
server.listen(PORT, () => console.log(`⚡ Server on port ${PORT}`));
