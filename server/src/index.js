const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const RoomManager = require("./RoomManager");
const MessageHandler = require("./socketHandlers");

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.get("/api/rooms/:roomId/exists", (req, res) => {
  const room = roomManager.getRoom(req.params.roomId.toUpperCase());
  res.json({ exists: !!room, size: room ? room.size : 0 });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

const roomManager = new RoomManager(io);
const messageHandler = new MessageHandler(io, roomManager);

io.on("connection", (socket) => {
  messageHandler.register(socket);
});

server.listen(PORT, () => {
  console.log(`Watch Party server listening on port ${PORT}`);
});
