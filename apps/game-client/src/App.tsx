import { Html, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  AuthResponse,
  ClientToServerEvents,
  PlayerState,
  ServerToClientEvents,
} from "shared";
import CharacterSelect from "./CharacterSelect";
import Login from "./Login";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3000";
const AUTH_STORAGE_KEY = "mmo-auth";
const CHARACTER_STORAGE_KEY = "mmo-character";

interface SelectedCharacter {
  id: number;
  name: string;
}

function Player({ player, isSelf }: { player: PlayerState; isSelf: boolean }) {
  return (
    <mesh position={[player.x, player.y, player.z]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={isSelf ? "orange" : "royalblue"} />
      <Html position={[0, 1, 0]} center distanceFactor={10}>
        <span className="player-label">
          {player.characterName} · Lv{player.level}
        </span>
      </Html>
    </mesh>
  );
}

function Game({
  auth,
  character,
  onCharacterInvalid,
  onSignOut,
  onChangeCharacter,
}: {
  auth: AuthResponse;
  character: SelectedCharacter;
  onCharacterInvalid: () => void;
  onSignOut: () => void;
  onChangeCharacter: () => void;
}) {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents>>(undefined);
  const [connected, setConnected] = useState(false);
  const [selfId, setSelfId] = useState<string>();
  const [players, setPlayers] = useState<PlayerState[]>([]);

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
      auth: { token: auth.token, characterId: character.id },
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setSelfId(socket.id);
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (err) => {
      // Only a bad/expired account token forces a full sign-out. Anything
      // else (stale/foreign character id, a transient server error) falls
      // back to character selection instead, since it's not a login
      // problem -- don't discard a perfectly good session over it.
      if (err.message === "unauthorized") {
        onSignOut();
      } else {
        onCharacterInvalid();
      }
    });
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
  }, [auth.token, character.id, onSignOut, onCharacterInvalid]);

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

  const self = players.find((p) => p.id === selfId);

  return (
    <div className="app-shell">
      <div className="status-bar">
        {connected ? `${character.name} connected` : "Connecting..."} — players online:{" "}
        {players.length}
        {self && (
          <span className="hud-stats">
            Lv{self.level} · {self.exp} XP · HP {self.hp}/{self.maxHp}
          </span>
        )}
        {/* Placeholder buttons standing in for real gameplay (mob kills,
            combat) until that system exists -- see CLAUDE.md. */}
        <button className="hud-button" onClick={() => socketRef.current?.emit("player:gainExp")}>
          Simulate kill (+10 XP)
        </button>
        <button
          className="hud-button"
          onClick={() => socketRef.current?.emit("player:takeDamage")}
        >
          Take damage (-10 HP)
        </button>
        <button className="signout-button" onClick={onChangeCharacter}>
          Change character
        </button>
        <button className="signout-button" onClick={onSignOut}>
          Sign out
        </button>
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

function App() {
  const [auth, setAuth] = useState<AuthResponse | undefined>(() => {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as AuthResponse) : undefined;
  });
  const [character, setCharacter] = useState<SelectedCharacter | undefined>(() => {
    const stored = localStorage.getItem(CHARACTER_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as SelectedCharacter) : undefined;
  });

  const handleAuthenticated = (next: AuthResponse) => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
    setAuth(next);
  };

  const handleSelectCharacter = (next: SelectedCharacter) => {
    localStorage.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(next));
    setCharacter(next);
  };

  const handleChangeCharacter = () => {
    localStorage.removeItem(CHARACTER_STORAGE_KEY);
    setCharacter(undefined);
  };

  const handleSignOut = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(CHARACTER_STORAGE_KEY);
    setAuth(undefined);
    setCharacter(undefined);
  };

  if (!auth) {
    return <Login onAuthenticated={handleAuthenticated} />;
  }

  if (!character) {
    return (
      <CharacterSelect
        token={auth.token}
        onSelect={handleSelectCharacter}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <Game
      auth={auth}
      character={character}
      onCharacterInvalid={handleChangeCharacter}
      onSignOut={handleSignOut}
      onChangeCharacter={handleChangeCharacter}
    />
  );
}

export default App;
