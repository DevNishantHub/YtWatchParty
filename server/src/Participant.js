const ROLES = Object.freeze({
  HOST: "host",
  MODERATOR: "moderator",
  PARTICIPANT: "participant",
});

/**
 * Represents a single connected user inside a Room.
 * Holds identity, role, and the underlying socket connection.
 */
class Participant {
  constructor({ socketId, userId, username, role = ROLES.PARTICIPANT }) {
    this.socketId = socketId;
    this.userId = userId;
    this.username = username;
    this.role = role;
    this.joinedAt = Date.now();
  }

  canControlPlayback() {
    return this.role === ROLES.HOST || this.role === ROLES.MODERATOR;
  }

  canManageRoom() {
    return this.role === ROLES.HOST;
  }

  setRole(role) {
    this.role = role;
  }

  toJSON() {
    return {
      userId: this.userId,
      username: this.username,
      role: this.role,
    };
  }
}

module.exports = { Participant, ROLES };
