export type Role = "host" | "moderator" | "participant";

export interface ParticipantInfo {
  userId: string;
  username: string;
  role: Role;
}

export interface PlayState {
  videoId: string | null;
  isPlaying: boolean;
  currentTime: number;
  lastUpdated: number;
}

export interface JoinAck {
  ok: boolean;
  error?: string;
  roomId?: string;
  userId?: string;
  role?: Role;
  participants?: ParticipantInfo[];
  playState?: PlayState;
}

export interface ChatMessage {
  userId: string;
  username: string;
  text: string;
  at: number;
}

export interface RoomSession {
  roomId: string;
  userId: string;
  username: string;
  role: Role;
}
