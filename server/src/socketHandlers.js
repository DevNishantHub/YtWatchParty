const { customAlphabet } = require("nanoid");
const { Participant, ROLES } = require("./Participant");

const userIdGen = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

/**
 * MessageHandler wires raw Socket.IO events to Room/Participant domain
 * logic. Keeping this separate from Room means Room has no knowledge
 * of sockets/wire format, and this file has no knowledge of room
 * invariants (single responsibility split).
 */
class MessageHandler {
  constructor(io, roomManager) {
    this.io = io;
    this.roomManager = roomManager;
  }

  register(socket) {
    socket.on("create_room", (payload, ack) => this.handleCreateRoom(socket, payload, ack));
    socket.on("join_room", (payload, ack) => this.handleJoinRoom(socket, payload, ack));
    socket.on("leave_room", (payload) => this.handleLeaveRoom(socket, payload));
    socket.on("play", () => this.handlePlayback(socket, "play", {}));
    socket.on("pause", () => this.handlePlayback(socket, "pause", {}));
    socket.on("seek", (payload) => this.handlePlayback(socket, "seek", payload));
    socket.on("change_video", (payload) => this.handlePlayback(socket, "change_video", payload));
    socket.on("assign_role", (payload) => this.handleAssignRole(socket, payload));
    socket.on("remove_participant", (payload) => this.handleRemoveParticipant(socket, payload));
    socket.on("transfer_host", (payload) => this.handleTransferHost(socket, payload));
    socket.on("chat_message", (payload) => this.handleChatMessage(socket, payload));
    socket.on("disconnect", () => this.handleDisconnect(socket));
  }

  // ---- helpers ----
  currentRoom(socket) {
    const roomId = socket.data.roomId;
    if (!roomId) return null;
    return this.roomManager.getRoom(roomId);
  }

  currentParticipant(socket) {
    const room = this.currentRoom(socket);
    if (!room) return null;
    return room.getBySocketId(socket.id);
  }

  fail(ack, error) {
    const message = error instanceof Error ? error.message : String(error);
    if (typeof ack === "function") ack({ ok: false, error: message });
  }

  // ---- handlers ----
  handleCreateRoom(socket, payload, ack) {
    try {
      const { username } = payload || {};
      if (!username || !username.trim()) throw new Error("USERNAME_REQUIRED");

      const room = this.roomManager.createRoom();
      const participant = new Participant({
        socketId: socket.id,
        userId: userIdGen(),
        username: username.trim(),
      });
      room.addParticipant(participant);

      socket.join(room.roomId);
      socket.data.roomId = room.roomId;
      socket.data.userId = participant.userId;

      if (typeof ack === "function") {
        ack({
          ok: true,
          roomId: room.roomId,
          userId: participant.userId,
          role: participant.role,
          participants: room.listParticipants(),
          playState: room.snapshotPlayState(),
        });
      }
    } catch (err) {
      this.fail(ack, err);
    }
  }

  handleJoinRoom(socket, payload, ack) {
    try {
      const { roomId, username } = payload || {};
      if (!roomId || !username || !username.trim()) {
        throw new Error("ROOM_ID_AND_USERNAME_REQUIRED");
      }
      const room = this.roomManager.getRoom(roomId.toUpperCase());
      if (!room) throw new Error("ROOM_NOT_FOUND");

      const participant = new Participant({
        socketId: socket.id,
        userId: userIdGen(),
        username: username.trim(),
        role: ROLES.PARTICIPANT,
      });
      room.addParticipant(participant);

      socket.join(room.roomId);
      socket.data.roomId = room.roomId;
      socket.data.userId = participant.userId;

      if (typeof ack === "function") {
        ack({
          ok: true,
          roomId: room.roomId,
          userId: participant.userId,
          role: participant.role,
          participants: room.listParticipants(),
          playState: room.snapshotPlayState(),
        });
      }

      socket.to(room.roomId).emit("user_joined", {
        username: participant.username,
        userId: participant.userId,
        role: participant.role,
        participants: room.listParticipants(),
      });
    } catch (err) {
      this.fail(ack, err);
    }
  }

  handleLeaveRoom(socket) {
    this.detachFromRoom(socket, "leave");
  }

  handleDisconnect(socket) {
    this.detachFromRoom(socket, "disconnect");
  }

  detachFromRoom(socket, _reason) {
    const room = this.currentRoom(socket);
    if (!room) return;

    const removed = room.removeBySocketId(socket.id);
    socket.leave(room.roomId);
    socket.data.roomId = null;

    if (removed) {
      this.io.to(room.roomId).emit("user_left", {
        username: removed.username,
        userId: removed.userId,
        participants: room.listParticipants(),
      });
      // If host changed as a side effect, let everyone know current roles.
      this.io.to(room.roomId).emit("role_assigned", {
        userId: room.hostUserId,
        username: room.getByUserId(room.hostUserId)?.username,
        role: ROLES.HOST,
        participants: room.listParticipants(),
      });
    }
    this.roomManager.deleteIfEmpty(room.roomId);
  }

  handlePlayback(socket, type, payload) {
    const room = this.currentRoom(socket);
    const participant = this.currentParticipant(socket);
    if (!room || !participant) return;

    try {
      room.applyPlaybackEvent(participant, type, payload || {});
      room.broadcastSyncState();
    } catch (err) {
      socket.emit("action_error", { action: type, error: err.message });
    }
  }

  handleAssignRole(socket, payload) {
    const room = this.currentRoom(socket);
    const participant = this.currentParticipant(socket);
    if (!room || !participant) return;

    try {
      const { userId, role } = payload || {};
      const target = room.assignRole(participant, userId, role);
      this.io.to(room.roomId).emit("role_assigned", {
        userId: target.userId,
        username: target.username,
        role: target.role,
        participants: room.listParticipants(),
      });
    } catch (err) {
      socket.emit("action_error", { action: "assign_role", error: err.message });
    }
  }

  handleRemoveParticipant(socket, payload) {
    const room = this.currentRoom(socket);
    const participant = this.currentParticipant(socket);
    if (!room || !participant) return;

    try {
      const { userId } = payload || {};
      const target = room.removeParticipant(participant, userId);

      // Force-disconnect the removed user's socket from the room.
      const targetSocket = this.io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.emit("you_were_removed");
        targetSocket.leave(room.roomId);
        targetSocket.data.roomId = null;
      }

      this.io.to(room.roomId).emit("participant_removed", {
        userId: target.userId,
        participants: room.listParticipants(),
      });
      this.roomManager.deleteIfEmpty(room.roomId);
    } catch (err) {
      socket.emit("action_error", { action: "remove_participant", error: err.message });
    }
  }

  handleTransferHost(socket, payload) {
    const room = this.currentRoom(socket);
    const participant = this.currentParticipant(socket);
    if (!room || !participant) return;

    try {
      const { userId } = payload || {};
      room.transferHost(participant, userId);
      this.io.to(room.roomId).emit("role_assigned", {
        userId: room.hostUserId,
        username: room.getByUserId(room.hostUserId)?.username,
        role: ROLES.HOST,
        participants: room.listParticipants(),
      });
    } catch (err) {
      socket.emit("action_error", { action: "transfer_host", error: err.message });
    }
  }

  handleChatMessage(socket, payload) {
    const room = this.currentRoom(socket);
    const participant = this.currentParticipant(socket);
    if (!room || !participant) return;
    const text = (payload && payload.text) ? String(payload.text).slice(0, 500) : "";
    if (!text.trim()) return;

    this.io.to(room.roomId).emit("chat_message", {
      userId: participant.userId,
      username: participant.username,
      text,
      at: Date.now(),
    });
  }
}

module.exports = MessageHandler;
