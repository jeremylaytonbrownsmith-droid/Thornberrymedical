import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { POLL_INTERVAL_MS } from './config.js';
import Header from './components/Header.jsx';
import RoomGrid from './components/RoomGrid.jsx';
import WaitingList from './components/WaitingList.jsx';
import SchedulePanel from './components/SchedulePanel.jsx';
import PatientPanel from './components/PatientPanel.jsx';

export default function App() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [selected, setSelected] = useState(null); // { patient, appt_time, provider_name, ... }

  const refresh = useCallback(async () => {
    try {
      setState(await api.getState());
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
      <Header state={state} nowMs={nowMs} act={act} />
      {error && <div className="error-banner">{error}</div>}
      <main className="layout">
        <section className="board-col">
          <RoomGrid rooms={state.rooms} nowMs={nowMs} act={act} onSelect={setSelected} />
          <WaitingList waiting={state.waiting} rooms={state.rooms} nowMs={nowMs} act={act} onSelect={setSelected} />
        </section>
        <aside className="side-col">
          <SchedulePanel scheduled={state.scheduled} act={act} onSelect={setSelected} />
        </aside>
      </main>
      {selected && <PatientPanel entry={selected} onClose={() => setSelected(null)} />}
      <footer className="footer">
        Demo environment — all patient data is synthetic. No real PHI is stored or displayed.
      </footer>
    </div>
  );
}
