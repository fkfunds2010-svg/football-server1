// ... (all your schema and room code is unchanged)
class FootballRoom extends Room {
  constructor() {
    super();
    // ... everything unchanged
  }

  static onAuth(client, options, request) {
    return true;   // <-- ADD THIS
  }

  onCreate(options) {
    // ... your existing code
  }
  // ... rest of the class is identical
}

// Server setup
const server = defineServer({
  rooms: {
    football: FootballRoom
  },
  express: (app) => {
    app.set("trust proxy", 1);                // <-- ADD THIS
    app.use(cors());
    app.use(express.json());

    app.use((req, res, next) => {
      res.setHeader(
        "Content-Security-Policy",
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data:; connect-src * ws: wss:; frame-src *;"
      );
      next();
    });

    app.get("/health", (req, res) => res.send("OK"));
    app.use("/playground", playground());
  }
});

server.listen(process.env.PORT || 2567, () => {
  console.log(`⚡ Server listening on port ${process.env.PORT || 2567}`);
});
