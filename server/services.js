// Core workflow transitions, shared by the HTTP API and the simulation loop
// so both paths enforce identical rules and nothing can get "stuck".
import { db, nowIso } from './db.js';
import { fakePatient, fakeProvider, ROOM_NAMES, REQUEST_TYPES, STAFF, pick, randInt } from './fake.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- reads ----------

export function getState() {
  const rooms = db.prepare(`
    SELECT r.id, r.name, r.status, r.current_appointment_id,
           a.id AS appointment_id, a.appt_time, a.provider_name, a.status AS appt_status,
           a.roomed_at, a.checked_in_at,
           p.id AS patient_id, p.first_name, p.last_initial, p.reason_for_visit,
           p.phone, p.date_of_birth
    FROM rooms r
    LEFT JOIN appointments a ON a.id = r.current_appointment_id
    LEFT JOIN patients p ON p.id = a.patient_id
    ORDER BY r.id
  `).all();

  const flags = db.prepare(`
    SELECT id, room_id, request_type, created_at, taken_by
    FROM staff_requests WHERE resolved_at IS NULL ORDER BY created_at
  `).all();
  const flagsByRoom = {};
  for (const f of flags) (flagsByRoom[f.room_id] ??= []).push(f);

  const waiting = db.prepare(`
    SELECT a.id AS appointment_id, a.appt_time, a.provider_name, a.checked_in_at, a.is_walk_in,
           p.id AS patient_id, p.first_name, p.last_initial, p.reason_for_visit,
           p.phone, p.date_of_birth
    FROM appointments a JOIN patients p ON p.id = a.patient_id
    WHERE a.status = 'waiting_room'
    ORDER BY a.checked_in_at
  `).all();

  const scheduled = db.prepare(`
    SELECT a.id AS appointment_id, a.appt_time, a.provider_name,
           p.id AS patient_id, p.first_name, p.last_initial, p.reason_for_visit,
           p.phone, p.date_of_birth
    FROM appointments a JOIN patients p ON p.id = a.patient_id
    WHERE a.status = 'scheduled'
    ORDER BY a.appt_time
    LIMIT 12
  `).all();

  const checkedOutToday = db.prepare(`
    SELECT COUNT(*) AS n FROM appointments
    WHERE status = 'checked_out' AND checked_out_at >= datetime('now', 'start of day')
  `).get().n;

  return {
    now: nowIso(),
    rooms: rooms.map((r) => ({ ...r, flags: flagsByRoom[r.id] ?? [] })),
    waiting,
    scheduled,
    checkedOutToday,
  };
}

function getAppt(id) {
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!appt) throw new ApiError(404, `No appointment with id ${id}`);
  return appt;
}

function getRoom(id) {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!room) throw new ApiError(404, `No room with id ${id}`);
  return room;
}

// ---------- transitions ----------

export function createPatientWithAppointment({ first_name, last_initial, reason_for_visit, provider_name, appt_time, is_walk_in = 0 }) {
  const base = fakePatient();
  const patient = {
    ...base,
    first_name: first_name?.trim() || base.first_name,
    last_initial: (last_initial?.trim() || base.last_initial).slice(0, 1).toUpperCase(),
    reason_for_visit: reason_for_visit?.trim() || base.reason_for_visit,
  };
  const pInfo = db.prepare(`
    INSERT INTO patients (first_name, last_initial, date_of_birth, reason_for_visit, phone)
    VALUES (@first_name, @last_initial, @date_of_birth, @reason_for_visit, @phone)
  `).run(patient);
  const aInfo = db.prepare(`
    INSERT INTO appointments (patient_id, appt_time, provider_name, status, is_walk_in)
    VALUES (?, ?, ?, 'scheduled', ?)
  `).run(pInfo.lastInsertRowid, appt_time ?? nowIso(), provider_name || fakeProvider(), is_walk_in ? 1 : 0);
  return { patient_id: pInfo.lastInsertRowid, appointment_id: aInfo.lastInsertRowid };
}

export function checkIn(apptId) {
  const appt = getAppt(apptId);
  if (appt.status !== 'scheduled') {
    throw new ApiError(400, `Cannot check in: appointment is '${appt.status}', expected 'scheduled'`);
  }
  db.prepare(`
    UPDATE appointments SET status = 'waiting_room', checked_in_at = ? WHERE id = ?
  `).run(nowIso(), apptId);
  return getAppt(apptId);
}

export const assignRoom = db.transaction((apptId, roomId) => {
  const appt = getAppt(apptId);
  if (appt.status !== 'waiting_room') {
    throw new ApiError(400, `Cannot room: appointment is '${appt.status}', expected 'waiting_room'`);
  }
  const room = getRoom(roomId);
  if (room.status !== 'empty') {
    throw new ApiError(400, `Room ${room.name} is not available (${room.status})`);
  }
  const ts = nowIso();
  db.prepare(`UPDATE appointments SET status = 'roomed', room_id = ?, roomed_at = ? WHERE id = ?`)
    .run(roomId, ts, apptId);
  db.prepare(`UPDATE rooms SET status = 'occupied', current_appointment_id = ? WHERE id = ?`)
    .run(apptId, roomId);
  return getAppt(apptId);
});

export function readyForCheckout(apptId) {
  const appt = getAppt(apptId);
  if (appt.status !== 'roomed') {
    throw new ApiError(400, `Cannot mark ready: appointment is '${appt.status}', expected 'roomed'`);
  }
  db.prepare(`UPDATE appointments SET status = 'ready_for_checkout' WHERE id = ?`).run(apptId);
  return getAppt(apptId);
}

export const checkout = db.transaction((apptId, { needsCleaning = true } = {}) => {
  const appt = getAppt(apptId);
  if (appt.status !== 'roomed' && appt.status !== 'ready_for_checkout') {
    throw new ApiError(400, `Cannot check out: appointment is '${appt.status}'`);
  }
  const ts = nowIso();
  db.prepare(`UPDATE appointments SET status = 'checked_out', checked_out_at = ? WHERE id = ?`)
    .run(ts, apptId);
  if (appt.room_id != null) {
    db.prepare(`UPDATE rooms SET status = ?, current_appointment_id = NULL WHERE id = ?`)
      .run(needsCleaning ? 'needs_cleaning' : 'empty', appt.room_id);
    // A freed room must never carry stale flags from its previous occupant.
    db.prepare(`UPDATE staff_requests SET resolved_at = ? WHERE room_id = ? AND resolved_at IS NULL`)
      .run(ts, appt.room_id);
  }
  return getAppt(apptId);
});

export function markRoomClean(roomId) {
  const room = getRoom(roomId);
  if (room.status !== 'needs_cleaning') {
    throw new ApiError(400, `Room ${room.name} is '${room.status}', expected 'needs_cleaning'`);
  }
  db.prepare(`UPDATE rooms SET status = 'empty' WHERE id = ?`).run(roomId);
  return getRoom(roomId);
}

export function raiseFlag(roomId, requestType) {
  const room = getRoom(roomId);
  if (!REQUEST_TYPES.includes(requestType)) {
    throw new ApiError(400, `Unknown request_type '${requestType}'. Valid: ${REQUEST_TYPES.join(', ')}`);
  }
  if (room.status !== 'occupied') {
    throw new ApiError(400, `Room ${room.name} has no patient to flag`);
  }
  const dup = db.prepare(`
    SELECT id FROM staff_requests WHERE room_id = ? AND request_type = ? AND resolved_at IS NULL
  `).get(roomId, requestType);
  if (dup) return db.prepare('SELECT * FROM staff_requests WHERE id = ?').get(dup.id);
  const info = db.prepare(`
    INSERT INTO staff_requests (room_id, request_type, created_at) VALUES (?, ?, ?)
  `).run(roomId, requestType, nowIso());
  return db.prepare('SELECT * FROM staff_requests WHERE id = ?').get(info.lastInsertRowid);
}

export function claimFlag(flagId, name) {
  const flag = db.prepare('SELECT * FROM staff_requests WHERE id = ?').get(flagId);
  if (!flag) throw new ApiError(404, `No staff request with id ${flagId}`);
  if (flag.resolved_at) throw new ApiError(400, 'Request is already resolved');
  if (flag.taken_by) return flag;
  db.prepare(`UPDATE staff_requests SET taken_by = ? WHERE id = ?`)
    .run((name || '').trim() || pick(STAFF), flagId);
  return db.prepare('SELECT * FROM staff_requests WHERE id = ?').get(flagId);
}

export function resolveFlag(flagId) {
  const flag = db.prepare('SELECT * FROM staff_requests WHERE id = ?').get(flagId);
  if (!flag) throw new ApiError(404, `No staff request with id ${flagId}`);
  if (flag.resolved_at) return flag;
  db.prepare(`UPDATE staff_requests SET resolved_at = ? WHERE id = ?`).run(nowIso(), flagId);
  return db.prepare('SELECT * FROM staff_requests WHERE id = ?').get(flagId);
}

// ---------- seed / reset ----------

export const reseed = db.transaction(() => {
  db.prepare('DELETE FROM staff_requests').run();
  db.prepare('UPDATE rooms SET current_appointment_id = NULL').run();
  db.prepare('DELETE FROM appointments').run();
  db.prepare('DELETE FROM patients').run();
  db.prepare('DELETE FROM rooms').run();

  const insertRoom = db.prepare(`INSERT INTO rooms (name, status) VALUES (?, 'empty')`);
  for (const name of ROOM_NAMES) insertRoom.run(name);

  const now = Date.now();
  const MIN = 60_000;

  // Upcoming schedule: appointments spread over the next ~90 minutes.
  for (let i = 0; i < 7; i++) {
    createPatientWithAppointment({ appt_time: new Date(now + randInt(5, 90) * MIN).toISOString() });
  }

  // A few patients already in the waiting room (checked in 2–15 minutes ago).
  for (let i = 0; i < 3; i++) {
    const { appointment_id } = createPatientWithAppointment({
      appt_time: new Date(now - randInt(0, 20) * MIN).toISOString(),
    });
    const checkedInAt = new Date(now - randInt(2, 15) * MIN).toISOString();
    db.prepare(`UPDATE appointments SET status = 'waiting_room', checked_in_at = ? WHERE id = ?`)
      .run(checkedInAt, appointment_id);
  }

  // A few patients already roomed, with staggered elapsed times so the
  // green/amber/red thresholds are all visible immediately after a reset.
  const roomIds = db.prepare(`SELECT id FROM rooms ORDER BY id`).all().map((r) => r.id);
  const elapsed = [3, 12, 24]; // minutes in room
  for (let i = 0; i < elapsed.length; i++) {
    const { appointment_id } = createPatientWithAppointment({
      appt_time: new Date(now - randInt(20, 40) * MIN).toISOString(),
    });
    const roomedAt = new Date(now - elapsed[i] * MIN).toISOString();
    const checkedInAt = new Date(now - (elapsed[i] + randInt(3, 10)) * MIN).toISOString();
    db.prepare(`
      UPDATE appointments SET status = 'roomed', room_id = ?, checked_in_at = ?, roomed_at = ? WHERE id = ?
    `).run(roomIds[i], checkedInAt, roomedAt, appointment_id);
    db.prepare(`UPDATE rooms SET status = 'occupied', current_appointment_id = ? WHERE id = ?`)
      .run(appointment_id, roomIds[i]);
  }

  // One active flag so the board shows the attention state right away,
  // backdated a couple of minutes so its elapsed timer reads meaningfully.
  raiseFlag(roomIds[1], pick(['ready_for_provider', 'needs_assistance', 'patient_waiting']));
  db.prepare(`UPDATE staff_requests SET created_at = ? WHERE resolved_at IS NULL`)
    .run(new Date(now - 2 * MIN).toISOString());
});

export function seedIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n;
  if (n === 0) reseed();
}
