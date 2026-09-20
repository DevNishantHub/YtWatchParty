const { customAlphabet } = require("nanoid");
const Room = require("./Room");

const nanoid = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

/**
 * Owns the lifecycle of all Room instances: creation, lookup, and
 * cleanup once a room becomes empty.
 */
class RoomManager {
  constructor(io) {
    this.io = io;
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
  }

  createRoom() {
    let roomId = nanoid();
    while (this.rooms.has(roomId)) roomId = nanoid();
    const room = new Room(roomId, this.io);
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  deleteIfEmpty(roomId) {
    const room = this.rooms.get(roomId);
    if (room && room.isEmpty()) {
      this.rooms.delete(roomId);
    }
  }
}

module.exports = RoomManager;
