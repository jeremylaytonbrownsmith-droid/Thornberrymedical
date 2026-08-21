// Pluff — patient-flow board demo server. Synthetic data only; no real
// patients, no external integrations, fully offline.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as svc from './services.js';
import { ApiError } from './services.js';
import { simEnabled, setSimEnabled, startSimLoop } from './sim.js';
import { REQUEST_TYPES } from './fake.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

const app = express();
app.use(express.json());

const wrap = (fn) => (req, res) => {
  try {
    res.json(fn(req));
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message });
  }
};

app.get('/api/state', wrap(() => ({
  ...svc.getState(),
  sim: { enabled: simEnabled() },
  requestTypes: REQUEST_TYPES,
})));

// Check-in / walk-in
app.post('/api/patients', wrap((req) => {
  const created = svc.createPatientWithAppointment({ ...req.body, is_walk_in: 1 });
  return svc.checkIn(created.appointment_id);
}));
app.post('/api/appointments/:id/checkin', wrap((req) => svc.checkIn(+req.params.id)));

// Rooming and checkout
app.post('/api/appointments/:id/room', wrap((req) => svc.assignRoom(+req.params.id, +req.body.room_id)));
app.post('/api/appointments/:id/ready-checkout', wrap((req) => svc.readyForCheckout(+req.params.id)));
app.post('/api/appointments/:id/checkout', wrap((req) => svc.checkout(+req.params.id, { needsCleaning: req.body?.needs_cleaning ?? true })));
app.post('/api/rooms/:id/clean', wrap((req) => svc.markRoomClean(+req.params.id)));

// Status / request flags
app.post('/api/rooms/:id/flags', wrap((req) => svc.raiseFlag(+req.params.id, req.body.request_type)));
app.post('/api/flags/:id/claim', wrap((req) => svc.claimFlag(+req.params.id, req.body?.name)));
app.post('/api/flags/:id/resolve', wrap((req) => svc.resolveFlag(+req.params.id)));

// eCW connector sync (see connector/). Optional shared secret via SYNC_TOKEN.
app.post('/api/sync/arrivals', wrap((req) => {
  if (process.env.SYNC_TOKEN && req.get('x-sync-token') !== process.env.SYNC_TOKEN) {
    throw new ApiError(401, 'invalid sync token');
  }
  return svc.syncArrivals(req.body?.arrivals ?? []);
}));

// Demo controls
app.post('/api/sim', wrap((req) => ({ enabled: setSimEnabled(req.body.enabled) })));
app.post('/api/reset', wrap(() => {
  svc.reseed();
  return { ok: true };
}));

// Serve the built client if present (production mode: `npm run build && npm start`)
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

svc.seedIfEmpty();
startSimLoop();

app.listen(PORT, () => {
  console.log(`Pluff flow board API on http://localhost:${PORT} (sim: ${simEnabled() ? 'on' : 'off'})`);
});
