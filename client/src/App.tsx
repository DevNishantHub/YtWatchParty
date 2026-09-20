import { useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import Room from "./pages/Room";
import type { RoomSession } from "./types";
import "./styles.css";

export default function App() {
  const [session, setSession] = useState<RoomSession | null>(null);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home onSession={setSession} />} />
        <Route path="/room/:roomId" element={<Room session={session} onSession={setSession} />} />
      </Routes>
    </BrowserRouter>
  );
}
