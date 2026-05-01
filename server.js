onJoin(client, options) {
  const pass = options?.password;
  // Allow Playground connections (no password) and correct password from clients
  if (pass && pass !== this.state.password) {
    client.send("error", { message: "Incorrect password" });
    client.leave();
    return;
  }

  const existingPlayer = this.state.players.get(client.sessionId);
  if (existingPlayer) {
    existingPlayer.reconnecting = false;
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
  this.broadcastPlayerInfo();
}
