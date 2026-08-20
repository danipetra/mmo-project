import { useEffect, useState } from "react";
import type { CharacterSummary, CreateCharacterRequest } from "shared";
import { apiFetch, ApiError } from "./api";
import "./CharacterSelect.css";

const MAX_CHARACTERS = 3;

interface CharacterSelectProps {
  token: string;
  onSelect: (character: { id: number; name: string }) => void;
  onSignOut: () => void;
}

function CharacterSelect({ token, onSelect, onSignOut }: CharacterSelectProps) {
  const [characters, setCharacters] = useState<CharacterSummary[]>();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const loadCharacters = () => {
    apiFetch<CharacterSummary[]>("/characters", token)
      .then(setCharacters)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load characters"));
  };

  useEffect(loadCharacters, [token]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      const body: CreateCharacterRequest = { name };
      await apiFetch<CharacterSummary>("/characters", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setName("");
      loadCharacters();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create character");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this character? This cannot be undone.")) return;
    setError(undefined);
    try {
      await apiFetch<void>(`/characters/${id}`, token, { method: "DELETE" });
      loadCharacters();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete character");
    }
  };

  if (!characters) {
    return <div className="charselect-shell">Loading characters...</div>;
  }

  return (
    <div className="charselect-shell">
      <div className="charselect-card">
        <h1>Choose a character</h1>
        {error && <p className="charselect-error">{error}</p>}
        <ul className="charselect-list">
          {characters.map((c) => (
            <li key={c.id} className="charselect-item">
              <div>
                <div className="charselect-name">{c.name}</div>
                <div className="charselect-meta">
                  Level {c.level} — {c.exp} XP
                </div>
              </div>
              <div className="charselect-actions">
                <button onClick={() => onSelect({ id: c.id, name: c.name })}>Play</button>
                <button className="charselect-delete" onClick={() => handleDelete(c.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>

        {characters.length < MAX_CHARACTERS ? (
          <form className="charselect-create" onSubmit={handleCreate}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New character name"
              minLength={3}
              maxLength={20}
              required
            />
            <button type="submit" disabled={submitting}>
              {submitting ? "..." : "Create"}
            </button>
          </form>
        ) : (
          <p className="charselect-limit">Maximum of {MAX_CHARACTERS} characters reached.</p>
        )}

        <button className="charselect-signout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

export default CharacterSelect;
