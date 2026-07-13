import { useState } from 'react';
import { api } from '../api.js';
import { FLAG_META } from '../config.js';
import { displayName, elapsedTone, formatClock, formatElapsed } from '../time.js';

function FlagChip({ flag, nowMs, act }) {
  const meta = FLAG_META[flag.request_type] ?? { label: flag.request_type, tone: 'warn' };
  return (
    <span className={`flag flag-${meta.tone}`}>
      {meta.label}
      <span className="flag-age" title="How long this request has been open">
        {formatElapsed(flag.created_at, nowMs)}
      </span>
      {flag.taken_by ? (
        <span className="flag-taken" title={`Taken by ${flag.taken_by}`}>· {flag.taken_by}</span>
      ) : (
        <button
          className="flag-btn"
          title="Take this request"
          onClick={(e) => {
            e.stopPropagation();
            act(() => api.claimFlag(flag.id));
          }}
        >
          Take
        </button>
      )}
      <button
        className="flag-btn"
        title="Resolve"
        onClick={(e) => {
          e.stopPropagation();
          act(() => api.resolveFlag(flag.id));
        }}
      >
        ✓
      </button>
    </span>
  );
}

function RoomCard({ room, nowMs, act, onSelect }) {
  const [flagPicker, setFlagPicker] = useState(false);
  const occupied = room.status === 'occupied';
  const tone = occupied ? elapsedTone(room.roomed_at, nowMs) : 'idle';
  const hasAlertFlag = room.flags.some((f) => (FLAG_META[f.request_type]?.tone ?? 'warn') === 'alert');
  const cardTone = hasAlertFlag ? 'alert' : tone;

  if (!occupied) {
    return (
      <div className={`room-card room-${room.status}`}>
        <div className="room-head">
          <span className="room-name">{room.name}</span>
          <span className="room-empty-label">{room.status === 'needs_cleaning' ? 'Needs cleaning' : 'Open'}</span>
        </div>
        {room.status === 'needs_cleaning' && (
          <button className="btn btn-small" onClick={() => act(() => api.markClean(room.id))}>
            Mark clean
          </button>
        )}
      </div>
    );
  }

  const patient = {
    first_name: room.first_name,
    last_initial: room.last_initial,
    reason_for_visit: room.reason_for_visit,
    phone: room.phone,
    date_of_birth: room.date_of_birth,
    provider_name: room.provider_name,
    appt_time: room.appt_time,
    context: room.name,
  };

  return (
    <div className={`room-card room-occupied tone-${cardTone}`} onClick={() => onSelect(patient)}>
      <div className="room-head">
        <span className="room-name">{room.name}</span>
        <span className={`elapsed elapsed-${tone}`} title="Time in room">
          {formatElapsed(room.roomed_at, nowMs)}
        </span>
      </div>
      <div className="room-patient">{displayName(room)}</div>
      <div className="room-meta">
        {formatClock(room.appt_time)} · {room.provider_name}
      </div>
      {room.flags.length > 0 && (
        <div className="room-flags">
          {room.flags.map((f) => <FlagChip key={f.id} flag={f} nowMs={nowMs} act={act} />)}
        </div>
      )}
      <div className="room-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-small btn-primary" onClick={() => act(() => api.checkout(room.appointment_id))}>
          Checkout
        </button>
        {flagPicker ? (
          <select
            autoFocus
            className="flag-select"
            defaultValue=""
            onBlur={() => setFlagPicker(false)}
            onChange={(e) => {
              const type = e.target.value;
              setFlagPicker(false);
              if (type) act(() => api.raiseFlag(room.id, type));
            }}
          >
            <option value="" disabled>Raise a flag…</option>
            {Object.entries(FLAG_META).map(([type, meta]) => (
              <option key={type} value={type}>{meta.label}</option>
            ))}
          </select>
        ) : (
          <button className="btn btn-small btn-ghost" onClick={() => setFlagPicker(true)}>+ Flag</button>
        )}
      </div>
    </div>
  );
}

export default function RoomGrid({ rooms, nowMs, act, onSelect }) {
  return (
    <div>
      <h2 className="section-title">Exam rooms</h2>
      <div className="room-grid">
        {rooms.map((room) => (
          <RoomCard key={room.id} room={room} nowMs={nowMs} act={act} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
