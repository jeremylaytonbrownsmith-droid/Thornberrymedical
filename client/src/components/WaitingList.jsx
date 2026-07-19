import { useState } from 'react';
import { api } from '../api.js';
import { displayName, elapsedTone, formatClock, formatElapsed } from '../time.js';

// The check-in queue. The board never owns scheduling or check-in — in
// production this list arrives from the EMR the moment a patient is checked
// in; in the demo the simulation plays the EMR's role. The staff action here
// is a single decision: which room.
export default function WaitingList({ waiting, rooms, act, nowMs, onSelect, wallMode }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_initial: '', reason_for_visit: '' });
  // A patient can go to an empty room or join a room with one person in it
  // (e.g. a couple seen together). Rooms needing cleaning are unavailable.
  const openRooms = rooms
    .filter((r) => r.status !== 'needs_cleaning' && r.occupants.length < 2)
    .map((r) => ({
      id: r.id,
      label: r.occupants.length === 0
        ? r.name
        : `${r.name} · join ${r.occupants[0].first_name} ${r.occupants[0].last_initial}.`,
    }));

  const submit = (e) => {
    e.preventDefault();
    act(() => api.addWalkIn(form));
    setForm({ first_name: '', last_initial: '', reason_for_visit: '' });
    setShowAdd(false);
  };

  return (
    <div className="queue-panel">
      <h2 className="section-title">
        Checked in <span className="count-pill">{waiting.length}</span>
      </h2>
      <p className="panel-hint">
        Patients appear here when they're checked in — fed from the EMR in a
        real clinic, simulated in this demo. Pick a room to place them.
      </p>
      {waiting.length === 0 ? (
        <div className="empty-note">No one is waiting for a room.</div>
      ) : (
        <ul className="queue-list">
          {waiting.map((w) => {
            const tone = elapsedTone(w.checked_in_at, nowMs);
            return (
              <li
                key={w.appointment_id}
                className="queue-row"
                style={wallMode ? { cursor: 'default' } : undefined}
                onClick={wallMode ? undefined : () => onSelect({ ...w, context: 'Checked in' })}
              >
                <div className="queue-main">
                  <div className="queue-name">
                    {displayName(w)}
                    {!wallMode && w.is_walk_in ? <span className="walkin-tag">manual</span> : null}
                  </div>
                  {!wallMode && <div className="queue-meta">{formatClock(w.appt_time)} · {w.provider_name}</div>}
                </div>
                <span className={`elapsed elapsed-${tone}`} title="Waiting since check-in">
                  {formatElapsed(w.checked_in_at, nowMs)}
                </span>
                {!wallMode && <span onClick={(e) => e.stopPropagation()}>
                  <select
                    className="room-select"
                    value=""
                    disabled={openRooms.length === 0}
                    onChange={(e) => {
                      const roomId = Number(e.target.value);
                      if (roomId) act(() => api.assignRoom(w.appointment_id, roomId));
                    }}
                  >
                    <option value="" disabled>
                      {openRooms.length === 0 ? 'No open rooms' : 'Room…'}
                    </option>
                    {openRooms.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                </span>}
              </li>
            );
          })}
        </ul>
      )}

      {wallMode ? null : showAdd ? (
        <form className="walkin-form" onSubmit={submit}>
          <input
            required
            placeholder="First name"
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
          />
          <input
            required
            placeholder="Last initial"
            maxLength={1}
            value={form.last_initial}
            onChange={(e) => setForm({ ...form, last_initial: e.target.value })}
          />
          <input
            placeholder="Reason for visit"
            value={form.reason_for_visit}
            onChange={(e) => setForm({ ...form, reason_for_visit: e.target.value })}
          />
          <div className="walkin-actions">
            <button type="submit" className="btn btn-small btn-primary">Add to queue</button>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn btn-ghost walkin-toggle" onClick={() => setShowAdd(true)}>
          + Add patient manually
        </button>
      )}
    </div>
  );
}
