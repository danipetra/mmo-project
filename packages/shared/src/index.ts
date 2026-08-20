export interface PlayerState {
  id: string;
  username: string;
  x: number;
  y: number;
  z: number;
}

export interface ServerStats {
  playersOnline: number;
  uptimeSeconds: number;
}

export interface ClientToServerEvents {
  "player:move": (state: Pick<PlayerState, "x" | "y" | "z">) => void;
}

export interface ServerToClientEvents {
  "world:state": (players: PlayerState[]) => void;
  "player:joined": (player: PlayerState) => void;
  "player:left": (playerId: string) => void;
}

export interface AuthCredentials {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  username: string;
}
