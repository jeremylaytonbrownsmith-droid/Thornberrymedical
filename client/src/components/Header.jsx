import { api } from '../api.js';
import { formatClock } from '../time.js';

export default function Header({ state, nowMs, act, theme, onToggleTheme, soundOn, onToggleSound }) {
  const occupied = state.rooms.filter((r) => r.status === 'occupied').length;

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark">◑</span>
        <span className="brand-name">Meridian</span>
        <span className="brand-sub">Thornberry Medical · Beaufort, South Carolina (Demo)</span>
      </div>
      <div className="header-stats">
        <span><strong>{occupied}</strong>/{state.rooms.length} rooms</span>
        <span><strong>{state.waiting.length}</strong> waiting</span>
        <span><strong>{state.checkedOutToday}</strong> seen today</span>
      </div>
      <div className="header-controls">
        <span className="clock">{formatClock(nowMs)}</span>
        <button
          className={`icon-toggle${soundOn ? ' active' : ''}`}
          title={soundOn ? 'Chime on new requests: on' : 'Chime on new requests: off'}
          onClick={onToggleSound}
        >
          {soundOn ? '🔔 Chime on' : '🔕 Chime off'}
        </button>
        <button
          className="icon-toggle"
          title="Switch between light and dark board"
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? '☀ Light board' : '☾ Dark board'}
        </button>
        <label className="sim-toggle" title="When on, synthetic patients move through the clinic automatically">
          <input
            type="checkbox"
            checked={state.sim.enabled}
            onChange={(e) => act(() => api.setSim(e.target.checked))}
          />
          <span>Simulation {state.sim.enabled ? 'on' : 'off'}</span>
        </label>
        <button
          className="btn btn-ghost"
          onClick={() => {
            if (window.confirm('Clear all demo data and reseed with fresh fake patients?')) {
              act(() => api.reset());
            }
          }}
        >
          Reset demo
        </button>
      </div>
    </header>
  );
}
