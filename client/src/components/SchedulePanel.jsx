import { useState } from 'react';
import { api } from '../api.js';
import { displayName, formatClock } from '../time.js';

export default function SchedulePanel({ scheduled, act, onSelect }) {
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [walkIn, setWalkIn] = useState({ first_name: '', last_initial: '', reason_for_visit: '' });

  const submitWalkIn = (e) => {
    e.preventDefault();
    act(() => api.addWalkIn(walkIn));
    setWalkIn({ first_name: '', last_initial: '', reason_for_visit: '' });
    setShowWalkIn(false);
  };

  return (
    <div className="schedule-panel">
      <h2 className="section-title">
        Up next <span className="count-pill">{scheduled.length}</span>
      </h2>
      <ul className="schedule-list">
        {scheduled.map((s) => (
          <li key={s.appointment_id} className="schedule-row" onClick={() => onSelect({ ...s, context: 'Scheduled' })}>
            <div>
              <div className="schedule-name">{displayName(s)}</div>
              <div className="schedule-meta">{formatClock(s.appt_time)} · {s.provider_name}</div>
            </div>
            <button
              className="btn btn-small btn-primary"
              onClick={(e) => {
                e.stopPropagation();
                act(() => api.checkIn(s.appointment_id));
              }}
            >
              Check in
            </button>
          </li>
        ))}
        {scheduled.length === 0 && <li className="empty-note">Nothing on the schedule.</li>}
      </ul>

      {showWalkIn ? (
        <form className="walkin-form" onSubmit={submitWalkIn}>
          <input
            required
            placeholder="First name"
            value={walkIn.first_name}
            onChange={(e) => setWalkIn({ ...walkIn, first_name: e.target.value })}
          />
          <input
            required
            placeholder="Last initial"
            maxLength={1}
            value={walkIn.last_initial}
            onChange={(e) => setWalkIn({ ...walkIn, last_initial: e.target.value })}
          />
          <input
            placeholder="Reason for visit"
            value={walkIn.reason_for_visit}
            onChange={(e) => setWalkIn({ ...walkIn, reason_for_visit: e.target.value })}
          />
          <div className="walkin-actions">
            <button type="submit" className="btn btn-small btn-primary">Check in walk-in</button>
            <button type="button" className="btn btn-small btn-ghost" onClick={() => setShowWalkIn(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn btn-ghost walkin-toggle" onClick={() => setShowWalkIn(true)}>
          + Add walk-in
        </button>
      )}
    </div>
  );
}
