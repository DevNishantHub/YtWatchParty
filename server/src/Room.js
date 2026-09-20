const { ROLES } = require("./Participant");

/**
 * Represents a single watch party room.
 * Owns: participant list, playback state, host identity, and
 * broadcast helpers. All mutation of room state should go through
 * this class so invariants (one host, valid roles, etc.) hold.
 */
class Room {
  constructor(roomId, io) {
    this.roomId = roomId;
    this.io = io;
    /** @type {Map<string, import('./Participant').Participant>} keyed by socketId */
    this.participants = new Map();
    this.hostUserId = null;

    this.playState = {
      videoId: null,
      isPlaying: false,
      currentTime: 0,
      lastUpdated: Date.now(),
    };

    this.createdAt = Date.now();
  }

  get size() {
    return this.participants.size;
  }

  /**
   * The video position "right now", accounting for time elapsed since the
   * last state change. playState.currentTime only records the position at
   * playState.lastUpdated — if the video is playing, real position keeps
   * advancing after that. Without this, every play/pause broadcast would
   * carry a stale currentTime and clients would seek back to it.
   */
  effectiveCurrentTime() {
    if (!this.playState.isPlaying) return this.playState.currentTime;
    const elapsed = (Date.now() - this.playState.lastUpdated) / 1000;
    return this.playState.currentTime + Math.max(0, elapsed);
  }

  /** A playState snapshot with currentTime resolved to "right now". */
  snapshotPlayState() {
    return {
      ...this.playState,
      currentTime: this.effectiveCurrentTime(),
    };
  }

  isEmpty() {
    return this.participants.size === 0;
  }

  addParticipant(participant) {
    // First person to ever join becomes Host.
    if (this.hostUserId === null) {
      participant.setRole(ROLES.HOST);
      this.hostUserId = participant.userId;
    }
    this.participants.set(participant.socketId, participant);
    return participant;
  }

  removeBySocketId(socketId) {
    const participant = this.participants.get(socketId);
    if (!participant) return null;
    this.participants.delete(socketId);

    // If the host left, auto-promote the longest-tenured remaining participant.
    if (participant.userId === this.hostUserId && !this.isEmpty()) {
      const next = [...this.participants.values()].sort(
        (a, b) => a.joinedAt - b.joinedAt
      )[0];
      next.setRole(ROLES.HOST);
      this.hostUserId = next.userId;
    }
    return participant;
  }

  getBySocketId(socketId) {
    return this.participants.get(socketId) || null;
  }

  getByUserId(userId) {
    return [...this.participants.values()].find((p) => p.userId === userId) || null;
  }

  listParticipants() {
    return [...this.participants.values()].map((p) => p.toJSON());
  }

  assignRole(actingParticipant, targetUserId, role) {
    if (!actingParticipant.canManageRoom()) {
      throw new Error("PERMISSION_DENIED: only host can assign roles");
    }
    if (![ROLES.MODERATOR, ROLES.PARTICIPANT].includes(role)) {
      throw new Error("INVALID_ROLE");
    }
    const target = this.getByUserId(targetUserId);
    if (!target) throw new Error("USER_NOT_FOUND");
    if (target.userId === this.hostUserId) {
      throw new Error("CANNOT_REASSIGN_HOST");
    }
    target.setRole(role);
    return target;
  }

  removeParticipant(actingParticipant, targetUserId) {
    if (!actingParticipant.canManageRoom()) {
      throw new Error("PERMISSION_DENIED: only host can remove participants");
    }
    const target = this.getByUserId(targetUserId);
    if (!target) throw new Error("USER_NOT_FOUND");
    if (target.userId === this.hostUserId) {
      throw new Error("CANNOT_REMOVE_HOST");
    }
    this.participants.delete(target.socketId);
    return target;
  }

  transferHost(actingParticipant, targetUserId) {
    if (!actingParticipant.canManageRoom()) {
      throw new Error("PERMISSION_DENIED: only host can transfer host");
    }
    const target = this.getByUserId(targetUserId);
    if (!target) throw new Error("USER_NOT_FOUND");

    actingParticipant.setRole(ROLES.MODERATOR);
    target.setRole(ROLES.HOST);
    this.hostUserId = target.userId;
    return target;
  }

  applyPlaybackEvent(actingParticipant, type, payload) {
    if (!actingParticipant.canControlPlayback()) {
      throw new Error(`PERMISSION_DENIED: role '${actingParticipant.role}' cannot control playback`);
    }
    const now = Date.now();
    switch (type) {
      case "play":
        // Resuming: keep whatever position we were paused/seeked at.
        this.playState.isPlaying = true;
        this.playState.lastUpdated = now;
        break;
      case "pause":
        // Freeze at the actual current position, not the position from
        // whenever the video last started playing.
        this.playState.currentTime = this.effectiveCurrentTime();
        this.playState.isPlaying = false;
        this.playState.lastUpdated = now;
        break;
      case "seek":
        this.playState.currentTime = payload.time;
        this.playState.lastUpdated = now;
        // isPlaying is intentionally left as-is: a seek while playing
        // should keep playing, a seek while paused should stay paused.
        break;
      case "change_video":
        this.playState.videoId = payload.videoId;
        this.playState.currentTime = 0;
        this.playState.isPlaying = true;
        this.playState.lastUpdated = now;
        break;
      default:
        throw new Error("UNKNOWN_PLAYBACK_EVENT");
    }
    return this.playState;
  }

  // ---- Broadcast helpers ----
  broadcastToRoom(event, payload) {
    this.io.to(this.roomId).emit(event, payload);
  }

  broadcastSyncState() {
    this.broadcastToRoom("sync_state", this.snapshotPlayState());
  }
}

module.exports = Room;
