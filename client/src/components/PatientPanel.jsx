import { displayName, formatClock } from '../time.js';

// Small detail panel for a selected patient. Models what a real board would
// surface (reason, provider, contact) without pretending to be a chart.
export default function PatientPanel({ entry, onClose }) {
  return (
    <div className="panel-backdrop" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div>
            <div className="panel-name">{displayName(entry)}</div>
            {entry.context && <div className="panel-context">{entry.context}</div>}
          </div>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <dl className="panel-details">
          <dt>Reason for visit</dt>
          <dd>{entry.reason_for_visit}</dd>
          <dt>Provider</dt>
          <dd>{entry.provider_name}</dd>
          <dt>Appointment</dt>
          <dd>{formatClock(entry.appt_time)}</dd>
          <dt>Date of birth</dt>
          <dd>{entry.date_of_birth}</dd>
          <dt>Phone</dt>
          <dd>{entry.phone}</dd>
        </dl>
        <div className="panel-note">Synthetic demo record — not a real person.</div>
      </div>
    </div>
  );
}
