import { api } from '../api.js';
import { displayName, elapsedTone, formatClock, formatElapsed } from '../time.js';

export default function WaitingList({ waiting, rooms, nowMs, act, onSelect }) {
  const openRooms = rooms.filter((r) => r.status === 'empty');

  return (
    <div className="waiting-section">
      <h2 className="section-title">
        Waiting room <span className="count-pill">{waiting.length}</span>
      </h2>
      {waiting.length === 0 ? (
        <div className="empty-note">No one is waiting.</div>
      ) : (
        <table className="waiting-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Appt</th>
              <th>Waiting</th>
              <th>Provider</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {waiting.map((w) => {
              const tone = elapsedTone(w.checked_in_at, nowMs);
              return (
                <tr key={w.appointment_id} onClick={() => onSelect({ ...w, context: 'Waiting room' })}>
                  <td className="patient-cell">
                    {displayName(w)}
                    {w.is_walk_in ? <span className="walkin-tag">walk-in</span> : null}
                  </td>
                  <td>{formatClock(w.appt_time)}</td>
                  <td><span className={`elapsed elapsed-${tone}`}>{formatElapsed(w.checked_in_at, nowMs)}</span></td>
                  <td>{w.provider_name}</td>
                  <td onClick={(e) => e.stopPropagation()}>
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
                        {openRooms.length === 0 ? 'No open rooms' : 'Assign room…'}
                      </option>
                      {openRooms.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
