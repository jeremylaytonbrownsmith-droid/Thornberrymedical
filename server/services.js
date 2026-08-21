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

// Rooms can hold two patients (e.g. a couple seen together).
export const ROOM_CAPACITY = 2;

function occupantsOf(roomId) {
  return db.prepare(`
    SELECT a.id AS appointment_id, a.appt_time, a.provider_name, a.status AS appt_status,
           a.roomed_at, a.checked_in_at, a.party_id,
           p.id AS patient_id, p.first_name, p.last_initial, p.reason_for_visit,
           p.phone, p.date_of_birth
    FROM appointments a JOIN patients p ON p.id = a.patient_id
    WHERE a.room_id = ? AND a.status IN ('roomed', 'ready_for_checkout')
    ORDER BY a.roomed_at
  `).all(roomId);
}

// ---------- reads ----------

export function getState() {
  const rooms = db.prepare(`SELECT id, name, status FROM rooms ORDER BY id`).all()
    .map((r) => ({ ...r, occupants: occupantsOf(r.id) }));

  const flags = db.prepare(`
    SELECT id, room_id, request_type, created_at, taken_by
    FROM staff_requests WHERE resolved_at IS NULL ORDER BY created_at
  `).all();
  const flagsByRoom = {};
  for (const f of flags) (flagsByRoom[f.room_id] ??= []).push(f);

  const waiting = db.prepare(`
    SELECT a.id AS appointment_id, a.appt_time, a.provider_name, a.checked_in_at, a.is_walk_in,
           a.party_id,
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

export function createPatientWithAppointment({ first_name, last_initial, reason_for_visit, provider_name, appt_time, is_walk_in = 0, party_id = null }) {
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
    INSERT INTO appointments (patient_id, appt_time, provider_name, status, is_walk_in, party_id)
    VALUES (?, ?, ?, 'scheduled', ?, ?)
  `).run(pInfo.lastInsertRowid, appt_time ?? nowIso(), provider_name || fakeProvider(), is_walk_in ? 1 : 0, party_id);
  return { patient_id: pInfo.lastInsertRowid, appointment_id: aInfo.lastInsertRowid, last_initial: patient.last_initial };
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
  if (room.status === 'needs_cleaning') {
    throw new ApiError(400, `Room ${room.name} needs cleaning first`);
  }
  const occupants = occupantsOf(roomId);
  if (occupants.length >= ROOM_CAPACITY) {
    throw new ApiError(400, `Room ${room.name} is full (${occupants.length}/${ROOM_CAPACITY})`);
  }
  const ts = nowIso();
  db.prepare(`UPDATE appointments SET status = 'roomed', room_id = ?, roomed_at = ? WHERE id = ?`)
    .run(roomId, ts, apptId);
  db.prepare(`UPDATE rooms SET status = 'occupied', current_appointment_id = COALESCE(current_appointment_id, ?) WHERE id = ?`)
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
    const remaining = occupantsOf(appt.room_id);
    if (remaining.length === 0) {
      // Last one out: free the room and clear its flags.
      db.prepare(`UPDATE rooms SET status = ?, current_appointment_id = NULL WHERE id = ?`)
        .run(needsCleaning ? 'needs_cleaning' : 'empty', appt.room_id);
      db.prepare(`UPDATE staff_requests SET resolved_at = ? WHERE room_id = ? AND resolved_at IS NULL`)
        .run(ts, appt.room_id);
    } else {
      // A companion is still in the room — it stays occupied.
      db.prepare(`UPDATE rooms SET current_appointment_id = ? WHERE id = ?`)
        .run(remaining[0].appointment_id, appt.room_id);
    }
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

// ---------- eCW connector sync ----------

// Reconciles arrival records from the connector idempotently, keyed by the
// eCW Encounter id: new active arrivals are created + checked in; ended
// visits are checked out. Rooming stays a human action on the board.
export const syncArrivals = db.transaction((arrivals) => {
  const summary = { created: 0, completed: 0, already: 0, skipped: 0 };
  for (const a of arrivals) {
    if (!a?.encounter_id) { summary.skipped++; continue; }
    const existing = db.prepare('SELECT * FROM appointments WHERE ecw_encounter_id = ?').get(String(a.encounter_id));
    if (!existing) {
      if (a.status !== 'active') { summary.skipped++; continue; }
      const created = createPatientWithAppointment({
        first_name: a.first_name,
        last_initial: a.last_initial,
        provider_name: a.provider_name,
        appt_time: a.appt_time,
        reason_for_visit: 'Office visit',
      });
      checkIn(created.appointment_id);
      db.prepare('UPDATE appointments SET ecw_encounter_id = ? WHERE id = ?')
        .run(String(a.encounter_id), created.appointment_id);
      summary.created++;
    } else if (a.status === 'ended' && ['waiting_room', 'roomed', 'ready_for_checkout'].includes(existing.status)) {
      if (existing.status === 'waiting_room') {
        // never roomed: close it out directly, no room to free
        db.prepare(`UPDATE appointments SET status = 'checked_out', checked_out_at = ? WHERE id = ?`)
          .run(nowIso(), existing.id);
      } else {
        checkout(existing.id, { needsCleaning: true });
      }
      summary.completed++;
    } else {
      summary.already++;
    }
  }
  return summary;
});

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
  const seedRoomed = (roomId, mins, opts = {}) => {
    const { appointment_id } = createPatientWithAppointment({
      appt_time: new Date(now - randInt(20, 40) * MIN).toISOString(),
      ...opts,
    });
    const roomedAt = new Date(now - mins * MIN).toISOString();
    const checkedInAt = new Date(now - (mins + randInt(3, 10)) * MIN).toISOString();
    db.prepare(`
      UPDATE appointments SET status = 'roomed', room_id = ?, checked_in_at = ?, roomed_at = ? WHERE id = ?
    `).run(roomId, checkedInAt, roomedAt, appointment_id);
    db.prepare(`UPDATE rooms SET status = 'occupied', current_appointment_id = COALESCE(current_appointment_id, ?) WHERE id = ?`)
      .run(appointment_id, roomId);
    return appointment_id;
  };
  for (let i = 0; i < elapsed.length; i++) seedRoomed(roomIds[i], elapsed[i]);

  // A couple sharing the first room, so the two-to-a-room feature is
  // visible immediately after a reset.
  const partnerOf = db.prepare(`
    SELECT a.id, p.last_initial FROM appointments a JOIN patients p ON p.id = a.patient_id
    WHERE a.room_id = ? AND a.status = 'roomed'
  `).get(roomIds[0]);
  const partnerId = seedRoomed(roomIds[0], elapsed[0], { last_initial: partnerOf.last_initial });
  db.prepare(`UPDATE appointments SET party_id = ? WHERE id IN (?, ?)`)
    .run(partnerOf.id, partnerOf.id, partnerId);

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
