import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { socket } from "../socket";
import type { JoinAck, RoomSession } from "../types";

interface Props {
  onSession: (session: RoomSession) => void;
}

export default function Home({ onSession }: Props) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [roomCode, setRoomCode] = useState(params.get("room") || "");
  const [mode, setMode] = useState<"create" | "join">(params.get("room") ? "join" : "create");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ensureConnected = () =>
    new Promise<void>((resolve) => {
      if (socket.connected) return resolve();
      socket.connect();
      socket.once("connect", () => resolve());
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim()) {
      setError("Enter a display name.");
      return;
    }
    setLoading(true);
    await ensureConnected();

    const event = mode === "create" ? "create_room" : "join_room";
    const payload =
      mode === "create"
        ? { username }
        : { username, roomId: roomCode.trim().toUpperCase() };

    socket.emit(event, payload, (ack: JoinAck) => {
      setLoading(false);
      if (!ack.ok || !ack.roomId || !ack.userId || !ack.role) {
        setError(ack.error || "Something went wrong.");
        return;
      }
      onSession({ roomId: ack.roomId, userId: ack.userId, username, role: ack.role });
      navigate(`/room/${ack.roomId}`);
    });
  };

  return (
    <div className="home-page">
      <div className="home-card">
        <h1>🎬 Watch Party</h1>
        <p className="subtitle">Watch YouTube videos together, perfectly in sync.</p>

        <div className="mode-toggle">
          <button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")} type="button">
            Create Room
          </button>
          <button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")} type="button">
            Join Room
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label>
            Display name
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. Sam"
              maxLength={24}
            />
          </label>

          {mode === "join" && (
            <label>
              Room code
              <input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="e.g. AB12CD"
                maxLength={8}
              />
            </label>
          )}

          {error && <p className="error-text">{error}</p>}

          <button type="submit" className="primary-btn" disabled={loading}>
            {loading ? "Connecting…" : mode === "create" ? "Create Room" : "Join Room"}
          </button>
        </form>
      </div>
    </div>
  );
}
