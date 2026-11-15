import { useState } from 'react';
import { type BridgeState, send } from '../ws';

export function PlacementSelect({ s }: { s: BridgeState }) {
  const { active, placements } = s.placements;
  return (
    <label className="placement-select">
      <span>Placement</span>
      <select
        value={active}
        disabled={!s.connected}
        onChange={(e) => send({ type: 'selectPlacement', name: e.target.value })}
      >
        {placements.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PlacementsPanel({ s }: { s: BridgeState }) {
  const { active, placements } = s.placements;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newName, setNewName] = useState('');
  const taken = (n: string) => placements.some((p) => p.name === n.trim());

  return (
    <section className="panel placements">
      <h2>Placements</h2>
      <p className="muted small">
        Calibrating saves into the active placement. Switching applies instantly.
      </p>
      <ul className="placement-list">
        {placements.map((p) => (
          <li key={p.name} className={p.name === active ? 'active' : ''}>
            {editing === p.name ? (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draft.trim() && (draft.trim() === p.name || !taken(draft))) {
                    send({ type: 'renamePlacement', from: p.name, to: draft.trim() });
                    setEditing(null);
                  }
                }}
              >
                <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={64} />
                <button
                  type="submit"
                  className="primary"
                  disabled={!draft.trim() || (draft.trim() !== p.name && taken(draft))}
                >
                  Save
                </button>
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="placement-name"
                  onClick={() => send({ type: 'selectPlacement', name: p.name })}
                  title="Use this placement"
                >
                  {p.name === active ? '● ' : '○ '}
                  {p.name}
                  <span className="muted small">
                    {' '}
                    {new Date(p.createdAt).getTime() > 0
                      ? new Date(p.createdAt).toLocaleString()
                      : 'uncalibrated (passthrough)'}
                    {p.threePoint ? ' · 3-point' : ''}
                  </span>
                </button>
                <span className="row">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(p.name);
                      setDraft(p.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      if (confirm(`Delete placement "${p.name}"?`))
                        send({ type: 'deletePlacement', name: p.name });
                    }}
                  >
                    Delete
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim() && !taken(newName)) {
            send({ type: 'savePlacement', name: newName.trim() });
            setNewName('');
          }
        }}
      >
        <input
          placeholder="e.g. desk left"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          maxLength={64}
        />
        <button type="submit" disabled={!newName.trim() || taken(newName)}>
          Save current as…
        </button>
      </form>
    </section>
  );
}
