# 🎬 YouTube Watch Party

Watch YouTube videos in sync with friends. Create a room, share the code, and everyone's
play/pause/seek/video-change actions stay perfectly synchronized — with host/moderator/participant
roles enforced on the backend.

**Live demo:** `[Live Demo Link](https://ytwatchparty-1.onrender.com/)`

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite, React Router, socket.io-client |
| Backend | Node.js + Express + Socket.IO |
| Realtime | WebSockets (via Socket.IO) |
| Video | YouTube IFrame Player API |
| State | In-memory (per Room instance) — no DB required for MVP |

---

## Project structure

```
watch-party/
├── server/                 # Express + Socket.IO backend
│   └── src/
│       ├── index.js        # entry point, HTTP + Socket.IO server
│       ├── Participant.js  # Participant class + ROLES enum
│       ├── Room.js         # Room class: state, roles, playback, broadcasts
│       ├── RoomManager.js  # creates/looks up/cleans up Room instances
│       └── socketHandlers.js # MessageHandler: wire events -> Room logic
├── client/                 # React + Vite frontend
│   └── src/
│       ├── pages/Home.tsx  # create / join room
│       ├── pages/Room.tsx  # main watch party UI
│       ├── components/YouTubePlayer.tsx
│       ├── socket.ts       # shared socket.io-client instance
│       └── types.ts
└── render.yaml              # optional one-click Render blueprint
```

---

## Running locally

### 1. Backend

```bash
cd server
cp .env.example .env      # defaults are fine for local dev
npm install
npm run dev                # nodemon, http://localhost:4000
```

### 2. Frontend

```bash
cd client
cp .env.example .env       # VITE_SERVER_URL=http://localhost:4000
npm install
npm run dev                 # http://localhost:5173
```

Open `http://localhost:5173` in two browser tabs (or two devices) to test sync — create a room in
one tab, join with the room code in the other.

---

## Architecture overview

**Rooms are the unit of state.** Each `Room` instance holds its own `participants` map and
`playState` (videoId, isPlaying, currentTime). There's no shared global mutable state — the
`RoomManager` just owns a `Map<roomId, Room>` and creates/deletes them.

**WebSocket flow:**

1. Client connects (`socket.io-client`, not auto-connected until the user submits the home form).
2. `create_room` / `join_room` are emitted with an **ack callback** — the server validates and
   responds synchronously with the room state so the client doesn't need a second round trip.
3. The client `socket.join(roomId)` on the server puts that socket in a Socket.IO room, so all
   future broadcasts (`io.to(roomId).emit(...)`) reach every participant with a single call.
4. Playback actions (`play`, `pause`, `seek`, `change_video`) are validated against the sender's
   role **on the server** before mutating `Room.playState`. If allowed, the server broadcasts the
   new authoritative `sync_state` to everyone in the room (including the sender, so all clients
   converge on one source of truth rather than trusting local UI state).
5. Role changes (`assign_role`, `remove_participant`, `transfer_host`) are host-only, enforced the
   same way, and broadcast `role_assigned` / `participant_removed` so every client's participant
   list and control visibility update immediately.

**Client sync strategy:** the `YouTubePlayer` component never treats local player events as truth.
When the *local* user (if they're host/mod) presses play/pause in the actual YouTube iframe, the
component emits an event to the server; it does **not** update local state directly. The server's
`sync_state` broadcast is what actually drives the player, via a `useEffect` that calls
`playVideo()/pauseVideo()/seekTo()`. A short "applying remote update" flag prevents the
`onStateChange` handler from re-emitting the change it just received, which would otherwise create
an infinite echo loop between client and server.

**Role enforcement (backend):** `Participant.canControlPlayback()` / `canManageRoom()` encapsulate
the permission rules. `Room.applyPlaybackEvent()` and `Room.assignRole()` /
`Room.removeParticipant()` throw a descriptive error if the acting participant lacks permission;
`socketHandlers.js` catches that and emits an `action_error` back to just that socket (not
broadcast), so a client cannot spoof control by hiding the "disabled" button in the UI — the server
is the actual gatekeeper.

**OOP structure (bonus requirement):**
- `Participant` — identity, role, and role-check helpers for one connected user.
- `Room` — encapsulates one watch party: participants, playback state, and all role/playback
  mutation methods; owns its own broadcast helpers.
- `RoomManager` — factory/registry for `Room` instances; the only place that creates or destroys
  rooms.
- `MessageHandler` (in `socketHandlers.js`) — translates Socket.IO wire events into calls on the
  above classes, and translates thrown domain errors into socket responses. This keeps Socket.IO
  specifics out of the domain classes entirely (they only depend on plain JS + the `io` reference
  for broadcasting).

---

## Roles & permission matrix

| Action | Host | Moderator | Participant |
|---|---|---|---|
| play / pause / seek / change video | ✅ | ✅ | ❌ |
| assign role | ✅ | ❌ | ❌ |
| remove participant | ✅ | ❌ | ❌ |
| transfer host | ✅ | ❌ | ❌ |
| chat | ✅ | ✅ | ✅ |

The room creator is auto-assigned Host. If the Host disconnects, the longest-tenured remaining
participant is auto-promoted to Host so the room never ends up leaderless.

---

## Deployment (Render)

You can deploy with the included `render.yaml` blueprint (Render → New → Blueprint → point at this
repo), or manually:

**Backend (Web Service):**
- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Env var: `CLIENT_ORIGIN=https://<your-frontend-url>`

**Frontend (Static Site):**
- Root directory: `client`
- Build command: `npm install && npm run build`
- Publish directory: `dist`
- Env var: `VITE_SERVER_URL=https://<your-backend-url>`
- Add a rewrite rule `/* → /index.html` so client-side routing (`/room/:roomId`) works on refresh.

After deploying, update the **Live demo** link at the top of this README.

---

## Known trade-offs / things to discuss

- **No persistence:** rooms live in server memory and disappear when empty or on server restart.
  Fine for the MVP scope; a Postgres/Mongo layer would be a straightforward addition (see
  `RoomManager` — it's the only place that would need to talk to a DB).
- **Single server instance:** works for the assignment's scale. Scaling to multiple instances would
  need the Socket.IO Redis adapter (`@socket.io/redis-adapter`) so `io.to(roomId).emit` reaches
  sockets connected to other instances — Room state itself would also need to move into Redis
  rather than in-process memory.
- **Seek sync is approximate:** YouTube doesn't push exact timestamp events, so seek sync is
  triggered explicitly (a "Sync seek position to room" button for host/mod) rather than inferred
  from continuous playback drift. A tolerance check (`>1.5s` drift) re-seeks joiners without
  fighting normal buffering jitter.
- **Chat is ephemeral** (bonus feature) — not stored, resets when the room empties.
