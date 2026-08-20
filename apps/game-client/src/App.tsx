import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Group } from "three";
import type {
  AuthResponse,
  ClientToServerEvents,
  PlayerState,
  ServerToClientEvents,
} from "shared";
import CharacterSelect from "./CharacterSelect";
import Login from "./Login";
import { PlayerModel } from "./PlayerModel";
import "./App.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3000";
const AUTH_STORAGE_KEY = "mmo-auth";
const CHARACTER_STORAGE_KEY = "mmo-character";
const MOVE_SPEED = 3; // world units per second
const MOVE_EMIT_INTERVAL_MS = 100;
const REMOTE_IDLE_TIMEOUT_MS = 400;

interface SelectedCharacter {
  id: number;
  name: string;
}

function PlayerLabel({ player }: { player: Pick<PlayerState, "characterName" | "level"> }) {
  return (
    <Html position={[0, 2, 0]} center distanceFactor={10}>
      <span className="player-label">
        {player.characterName} · Lv{player.level}
      </span>
    </Html>
  );
}

// Renders another connected player at whatever position the server last
// broadcast. There's no local prediction for remote players, only a simple
// idle/walk heuristic: treat a player as "moving" for a short window after
// their position last changed, since the server doesn't send a moving flag.
function RemotePlayer({ player }: { player: PlayerState }) {
  const [isMoving, setIsMoving] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setIsMoving(true);
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setIsMoving(false), REMOTE_IDLE_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutRef.current);
  }, [player.x, player.z]);

  return (
    <group position={[player.x, player.y, player.z]}>
      <PlayerModel isMoving={isMoving} />
      <PlayerLabel player={player} />
    </group>
  );
}

// The locally-controlled player. Position lives entirely in a ref, updated
// every frame from held keys, and applied directly to the group's transform
// -- not through React state, which would re-render every frame for no
// benefit. `self` only supplies the *initial* spawn position (read once,
// via useRef's lazy initializer) plus the live HUD stats (level/exp/hp),
// which the server keeps up to date independently via player:gainExp /
// player:takeDamage broadcasts that include the sender.
function LocalPlayer({
  self,
  onMove,
}: {
  self: PlayerState;
  onMove: (x: number, z: number) => void;
}) {
  const groupRef = useRef<Group>(null);
  const position = useRef({ x: self.x, y: self.y, z: self.z });
  const keys = useRef<Set<string>>(new Set());
  const isMovingRef = useRef(false);
  const lastEmitRef = useRef(0);
  const [isMoving, setIsMoving] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keys.current.add(e.key.toLowerCase());
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useFrame((state, delta) => {
    const pressed = keys.current;
    let dx = 0;
    let dz = 0;
    if (pressed.has("arrowup") || pressed.has("w")) dz -= 1;
    if (pressed.has("arrowdown") || pressed.has("s")) dz += 1;
    if (pressed.has("arrowleft") || pressed.has("a")) dx -= 1;
    if (pressed.has("arrowright") || pressed.has("d")) dx += 1;

    const moving = dx !== 0 || dz !== 0;
    if (moving !== isMovingRef.current) {
      isMovingRef.current = moving;
      setIsMoving(moving);
    }

    if (moving && groupRef.current) {
      const length = Math.hypot(dx, dz);
      const nx = dx / length;
      const nz = dz / length;
      position.current.x += nx * MOVE_SPEED * delta;
      position.current.z += nz * MOVE_SPEED * delta;
      groupRef.current.position.set(position.current.x, position.current.y, position.current.z);
      groupRef.current.rotation.y = Math.atan2(nx, nz);

      const now = state.clock.elapsedTime * 1000;
      if (now - lastEmitRef.current > MOVE_EMIT_INTERVAL_MS) {
        lastEmitRef.current = now;
        onMove(position.current.x, position.current.z);
      }
    }
  });

  return (
    <group ref={groupRef} position={[self.x, self.y, self.z]}>
      <PlayerModel isMoving={isMoving} />
      <PlayerLabel player={self} />
    </group>
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

  const handleLocalMove = useCallback((x: number, z: number) => {
    socketRef.current?.emit("player:move", { x, y: 0, z });
  }, []);

  const self = players.find((p) => p.id === selfId);
  const others = players.filter((p) => p.id !== selfId);

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
        {/* useGLTF suspends while the model loads -- everything that renders
            a PlayerModel needs to sit under this boundary. */}
        <Suspense fallback={null}>
          {others.map((player) => (
            <RemotePlayer key={player.id} player={player} />
          ))}
          {self && <LocalPlayer self={self} onMove={handleLocalMove} />}
        </Suspense>
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
