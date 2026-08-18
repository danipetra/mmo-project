import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  PlayerState,
  ServerToClientEvents,
} from "shared";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3000";

function Player({ player, isSelf }: { player: PlayerState; isSelf: boolean }) {
  return (
    <mesh position={[player.x, player.y, player.z]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={isSelf ? "orange" : "royalblue"} />
    </mesh>
  );
}

function App() {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents>>(undefined);
  const [connected, setConnected] = useState(false);
  const [selfId, setSelfId] = useState<string>();
  const [players, setPlayers] = useState<PlayerState[]>([]);

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setSelfId(socket.id);
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("world:state", (state) => setPlayers(state));
    socket.on("player:joined", (player) =>
      setPlayers((prev) => [...prev.filter((p) => p.id !== player.id), player]),
    );
    socket.on("player:left", (playerId) =>
      setPlayers((prev) => prev.filter((p) => p.id !== playerId)),
    );

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const self = players.find((p) => p.id === selfId);
      if (!self || !socketRef.current) return;
      const step = 0.5;
      const move = { x: self.x, y: self.y, z: self.z };
      if (e.key === "ArrowUp") move.z -= step;
      if (e.key === "ArrowDown") move.z += step;
      if (e.key === "ArrowLeft") move.x -= step;
      if (e.key === "ArrowRight") move.x += step;
      socketRef.current.emit("player:move", move);
      setPlayers((prev) =>
        prev.map((p) => (p.id === selfId ? { ...p, ...move } : p)),
      );
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [players, selfId]);

  return (
    <div className="app-shell">
      <div className="status-bar">
        {connected ? `Connected as ${selfId}` : "Connecting..."} — players
        online: {players.length}
      </div>
      <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 10, 5]} intensity={1} />
        <gridHelper args={[20, 20]} />
        {players.map((player) => (
          <Player key={player.id} player={player} isSelf={player.id === selfId} />
        ))}
        <OrbitControls />
      </Canvas>
    </div>
  );
}

export default App;
