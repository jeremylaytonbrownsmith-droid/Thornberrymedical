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

function OccupantRow({ occ, room, solo, nowMs, act, onSelect, wallMode }) {
  const tone = elapsedTone(occ.roomed_at, nowMs);
  return (
    <div
      className={`occupant ${solo ? 'occupant-solo' : ''}`}
      style={wallMode ? { cursor: 'default' } : undefined}
      onClick={wallMode ? undefined : () => onSelect({ ...occ, context: room.name })}
    >
      <div className="occupant-main">
        <span className="occupant-name">{displayName(occ)}</span>
        {!wallMode && <span className="room-meta">{formatClock(occ.appt_time)} · {occ.provider_name}</span>}
      </div>
      <span className={`elapsed elapsed-${tone}`} title="Time in room">
        {formatElapsed(occ.roomed_at, nowMs)}
      </span>
      {!wallMode && (
        <button
          className="btn btn-small btn-primary"
          onClick={(e) => {
            e.stopPropagation();
            act(() => api.checkout(occ.appointment_id));
          }}
        >
          Checkout
        </button>
      )}
    </div>
  );
}

function RoomCard({ room, nowMs, act, onSelect, wallMode }) {
  const [flagPicker, setFlagPicker] = useState(false);
  const occupied = room.status === 'occupied' && room.occupants.length > 0;

  if (!occupied) {
    return (
      <div className={`room-card room-${room.status}`}>
        <div className="room-head">
          <span className="room-name">{room.name}</span>
          <span className="room-empty-label">{room.status === 'needs_cleaning' ? 'Needs cleaning' : 'Open'}</span>
        </div>
        {room.status === 'needs_cleaning' && !wallMode && (
          <button className="btn btn-small" onClick={() => act(() => api.markClean(room.id))}>
            Mark clean
          </button>
        )}
      </div>
    );
  }

  // The card border reflects the most urgent occupant (or an alert flag).
  const tones = room.occupants.map((o) => elapsedTone(o.roomed_at, nowMs));
  const worstTone = tones.includes('alert') ? 'alert' : tones.includes('warn') ? 'warn' : 'ok';
  const hasAlertFlag = room.flags.some((f) => (FLAG_META[f.request_type]?.tone ?? 'warn') === 'alert');
  const cardTone = hasAlertFlag ? 'alert' : worstTone;
  const solo = room.occupants.length === 1;

  return (
    <div className={`room-card room-occupied tone-${cardTone}`}>
      <div className="room-head">
        <span className="room-name">{room.name}</span>
        {!solo && <span className="room-empty-label">{room.occupants.length} patients</span>}
      </div>
      {room.occupants.map((occ) => (
        <OccupantRow
          key={occ.appointment_id}
          occ={occ}
          room={room}
          solo={solo}
          nowMs={nowMs}
          act={act}
          onSelect={onSelect}
          wallMode={wallMode}
        />
      ))}
      {room.flags.length > 0 && (
        <div className="room-flags">
          {room.flags.map((f) => (
            wallMode ? (
              // wall mode: a colored dot signals attention without exposing
              // what the request is
              <span
                key={f.id}
                className={`flag-dot flag-dot-${FLAG_META[f.request_type]?.tone ?? 'warn'}`}
                title="Staff request"
              >
                ●
              </span>
            ) : (
              <FlagChip key={f.id} flag={f} nowMs={nowMs} act={act} />
            )
          ))}
        </div>
      )}
      {wallMode ? null : (
      <div className="room-actions" onClick={(e) => e.stopPropagation()}>
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
      )}
    </div>
  );
}

export default function RoomGrid({ rooms, nowMs, act, onSelect, wallMode }) {
  return (
    <div>
      <h2 className="section-title">Exam rooms</h2>
      <div className="room-grid">
        {rooms.map((room) => (
          <RoomCard key={room.id} room={room} nowMs={nowMs} act={act} onSelect={onSelect} wallMode={wallMode} />
        ))}
      </div>
    </div>
  );
}
