import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { POLL_INTERVAL_MS } from './config.js';
import { chime } from './chime.js';
import Header from './components/Header.jsx';
import RoomGrid from './components/RoomGrid.jsx';
import WaitingList from './components/WaitingList.jsx';
import PatientPanel from './components/PatientPanel.jsx';

export default function App() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [selected, setSelected] = useState(null); // { patient, appt_time, provider_name, ... }
  const [theme, setTheme] = useState(() => localStorage.getItem('pluff-theme') || 'light');
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('pluff-sound') === 'on');
  const seenFlagIds = useRef(null);
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('pluff-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('pluff-sound', soundOn ? 'on' : 'off');
  }, [soundOn]);

  const refresh = useCallback(async () => {
    try {
      const next = await api.getState();
      // Chime once per newly raised flag (skip the very first load).
      const ids = new Set(next.rooms.flatMap((r) => r.flags.map((f) => f.id)));
      if (seenFlagIds.current && soundOnRef.current) {
        for (const id of ids) {
          if (!seenFlagIds.current.has(id)) { chime(); break; }
        }
      }
      seenFlagIds.current = ids;
      setState(next);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // Poll the server for board state; tick a local clock every second so
  // elapsed times count up smoothly between polls.
  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, POLL_INTERVAL_MS);
    const clock = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [refresh]);

  // Every staff action refreshes the board immediately rather than waiting
  // for the next poll. Errors (e.g. sim raced us to the same patient) are
  // shown briefly, then cleared by the next successful poll.
  const act = useCallback(async (fn) => {
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    }
    refresh();
  }, [refresh]);

  if (!state) {
    return <div className="boot">{error ? `Cannot reach the board server: ${error}` : 'Connecting to board…'}</div>;
  }

  return (
    <div className="app">
      <Header
        state={state}
        nowMs={nowMs}
        act={act}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        soundOn={soundOn}
        onToggleSound={() => setSoundOn(!soundOn)}
      />
      {error && <div className="error-banner">{error}</div>}
      <main className="layout">
        <section className="board-col">
          <RoomGrid rooms={state.rooms} nowMs={nowMs} act={act} onSelect={setSelected} />
        </section>
        <aside className="side-col">
          <WaitingList waiting={state.waiting} rooms={state.rooms} nowMs={nowMs} act={act} onSelect={setSelected} />
        </aside>
      </main>
      {selected && <PatientPanel entry={selected} onClose={() => setSelected(null)} />}
      <footer className="footer">
        Demo environment — all patient data is synthetic. No real PHI is stored or displayed.
      </footer>
    </div>
  );
}
