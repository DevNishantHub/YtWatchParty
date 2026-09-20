import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { socket } from "../socket";
import YouTubePlayer from "../components/YouTubePlayer";
import { extractVideoId } from "../utils/youtube";
import type { ChatMessage, ParticipantInfo, PlayState, Role, RoomSession } from "../types";

interface Props {
  session: RoomSession | null;
  onSession: (session: RoomSession | null) => void;
}

const ROLE_LABEL: Record<Role, string> = {
  host: "Host",
  moderator: "Moderator",
  participant: "Participant",
};

export default function Room({ session, onSession }: Props) {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [playState, setPlayState] = useState<PlayState>({
    videoId: null,
    isPlaying: false,
    currentTime: 0,
    lastUpdated: Date.now(),
  });
  const [videoInput, setVideoInput] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const me = session ? participants.find((p) => p.userId === session.userId) : undefined;
  const myRole: Role = me?.role || session?.role || "participant";
  const isHost = myRole === "host";
  const canControl = myRole === "host" || myRole === "moderator";

  useEffect(() => {
    if (!session || session.roomId !== roomId) {
      navigate(`/?room=${roomId || ""}`);
      return;
    }

    const onSync = (state: PlayState) => setPlayState(state);
    const onUserJoined = (data: { participants: ParticipantInfo[] }) => setParticipants(data.participants);
    const onUserLeft = (data: { participants: ParticipantInfo[] }) => setParticipants(data.participants);
    const onRoleAssigned = (data: { participants: ParticipantInfo[] }) => setParticipants(data.participants);
    const onParticipantRemoved = (data: { participants: ParticipantInfo[] }) => setParticipants(data.participants);
    const onChat = (msg: ChatMessage) => setChat((prev) => [...prev, msg]);
    const onActionError = (data: { error: string }) => {
      setActionError(data.error);
      setTimeout(() => setActionError(null), 3000);
    };
    const onRemoved = () => {
      alert("You were removed from the room by the host.");
      onSession(null);
      navigate("/");
    };
    const onDisconnect = () => {
      // socket.io auto-reconnects; state resyncs via sync_state / server truth on next action.
    };

    socket.on("sync_state", onSync);
    socket.on("user_joined", onUserJoined);
    socket.on("user_left", onUserLeft);
    socket.on("role_assigned", onRoleAssigned);
    socket.on("participant_removed", onParticipantRemoved);
    socket.on("chat_message", onChat);
    socket.on("action_error", onActionError);
    socket.on("you_were_removed", onRemoved);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("sync_state", onSync);
      socket.off("user_joined", onUserJoined);
      socket.off("user_left", onUserLeft);
      socket.off("role_assigned", onRoleAssigned);
      socket.off("participant_removed", onParticipantRemoved);
      socket.off("chat_message", onChat);
      socket.off("action_error", onActionError);
      socket.off("you_were_removed", onRemoved);
      socket.off("disconnect", onDisconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, session]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const handleLeave = () => {
    socket.emit("leave_room", { roomId });
    onSession(null);
    navigate("/");
  };

  const handleChangeVideo = (e: React.FormEvent) => {
    e.preventDefault();
    const videoId = extractVideoId(videoInput);
    if (!videoId) {
      setActionError("Couldn't parse a YouTube video ID from that input.");
      setTimeout(() => setActionError(null), 3000);
      return;
    }
    socket.emit("change_video", { videoId });
    setVideoInput("");
  };

  const handleAssignRole = (userId: string, role: Role) => {
    socket.emit("assign_role", { userId, role });
  };

  const handleRemove = (userId: string) => {
    if (confirm("Remove this participant from the room?")) {
      socket.emit("remove_participant", { userId });
    }
  };

  const handleTransferHost = (userId: string) => {
    if (confirm("Transfer host role to this participant? You will become a moderator.")) {
      socket.emit("transfer_host", { userId });
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socket.emit("chat_message", { text: chatInput });
    setChatInput("");
  };

  const copyInvite = () => {
    const url = `${window.location.origin}/?room=${roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (!session) return null;

  return (
    <div className="room-page">
      <header className="room-header">
        <div>
          <h2>Room {roomId}</h2>
          <span className={`role-badge role-${myRole}`}>{ROLE_LABEL[myRole]}</span>
        </div>
        <div className="header-actions">
          <button onClick={copyInvite} className="ghost-btn">
            {copied ? "Copied!" : "Copy invite link"}
          </button>
          <button onClick={handleLeave} className="ghost-btn danger">
            Leave
          </button>
        </div>
      </header>

      {actionError && <div className="toast-error">{actionError}</div>}

      <div className="room-body">
        <main className="room-main">
          {playState.videoId ? (
            <YouTubePlayer
              playState={playState}
              canControl={canControl}
              onLocalPlay={() => socket.emit("play")}
              onLocalPause={() => socket.emit("pause")}
              onLocalSeek={(time) => socket.emit("seek", { time })}
            />
          ) : (
            <div className="no-video">
              <p>No video loaded yet.</p>
              {!canControl && <p className="hint">Ask the host or a moderator to start one.</p>}
            </div>
          )}

          {canControl && (
            <form className="video-form" onSubmit={handleChangeVideo}>
              <input
                value={videoInput}
                onChange={(e) => setVideoInput(e.target.value)}
                placeholder="Paste a YouTube URL or video ID…"
              />
              <button type="submit">Load Video</button>
            </form>
          )}
        </main>

        <aside className="room-sidebar">
          <section className="participants-panel">
            <h3>Participants ({participants.length})</h3>
            <ul>
              {participants.map((p) => (
                <li key={p.userId} className={p.userId === session.userId ? "me" : ""}>
                  <span className="p-name">
                    {p.username} {p.userId === session.userId && "(you)"}
                  </span>
                  <span className={`role-badge role-${p.role}`}>{ROLE_LABEL[p.role]}</span>
                  {isHost && p.userId !== session.userId && (
                    <div className="host-controls">
                      {p.role !== "moderator" && (
                        <button onClick={() => handleAssignRole(p.userId, "moderator")}>Make Mod</button>
                      )}
                      {p.role !== "participant" && (
                        <button onClick={() => handleAssignRole(p.userId, "participant")}>Make Viewer</button>
                      )}
                      <button onClick={() => handleTransferHost(p.userId)}>Make Host</button>
                      <button className="danger" onClick={() => handleRemove(p.userId)}>
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="chat-panel">
            <h3>Chat</h3>
            <div className="chat-messages">
              {chat.map((m, i) => (
                <div key={i} className="chat-msg">
                  <strong>{m.username}:</strong> {m.text}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleSendChat} className="chat-form">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Say something…"
                maxLength={500}
              />
              <button type="submit">Send</button>
            </form>
          </section>
        </aside>
      </div>
    </div>
  );
}
