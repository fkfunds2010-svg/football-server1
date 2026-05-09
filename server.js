});
gameServer.define("football", FootballRoom);

// ✅ CORRECT: use the singleton matchMaker, not gameServer.matchmaker
// ✅ CORRECT: use the singleton matchMaker with auth: {} to avoid token error
app.post("/matchmake/create/:roomName", async (req, res) => {
  try {
    const { roomName } = req.params;
    const options = req.body || {};
    const reservation = await matchMaker.create(roomName, options);
    const clientOptions = { ...(req.body || {}), auth: {} };
    const reservation = await matchMaker.create(roomName, clientOptions);
    res.json({ roomId: reservation.room.roomId, sessionId: reservation.sessionId });
  } catch (e) {
    res.status(400).json({ error: e.message });
@@ -352,8 +352,8 @@ app.post("/matchmake/create/:roomName", async (req, res) => {
app.post("/matchmake/joinOrCreate/:roomName", async (req, res) => {
  try {
    const { roomName } = req.params;
    const options = req.body || {};
    const reservation = await matchMaker.joinOrCreate(roomName, options);
    const clientOptions = { ...(req.body || {}), auth: {} };
    const reservation = await matchMaker.joinOrCreate(roomName, clientOptions);
    res.json({ roomId: reservation.room.roomId, sessionId: reservation.sessionId });
  } catch (e) {
    res.status(400).json({ error: e.message });
@@ -363,12 +363,14 @@ app.post("/matchmake/joinOrCreate/:roomName", async (req, res) => {
app.post("/matchmake/joinById/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;
    const options = req.body || {};
    const reservation = await matchMaker.joinById(roomId, options);
    const clientOptions = { ...(req.body || {}), auth: {} };
    const reservation = await matchMaker.joinById(roomId, clientOptions);
    res.json({ roomId: reservation.room.roomId, sessionId: reservation.sessionId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});httpServer.listen(Number(process.env.PORT) || 2567, () => {
});

httpServer.listen(Number(process.env.PORT) || 2567, () => {
  console.log(`⚡ Server listening on port ${process.env.PORT || 2567}`);
});
