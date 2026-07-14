// Demo simulation loop. When enabled, it walks synthetic patients through the
// full lifecycle on a timer (time-compressed, so the board visibly changes
// within seconds) while leaving every manual control fully usable.
import { db, nowIso } from './db.js';
import * as svc from './services.js';
import { pick, randInt, REQUEST_TYPES } from './fake.js';

const TICK_MS = 4000;

// Time-compressed pacing (real clinics take minutes; the demo takes seconds).
const PACE = {
  minVisitSeconds: 40,        // minimum time roomed before the visit can wrap up
  minFlagClaimSeconds: 8,     // sim staff claim ("take") a flag after this
  minFlagAgeSeconds: 20,      // sim only auto-resolves flags older than this
  maxWaiting: 5,              // EMR feed pauses when the queue is this deep
};

const chance = (p) => Math.random() < p;
const ageSeconds = (iso) => (Date.now() - new Date(iso).getTime()) / 1000;

let enabled = true;
let timer = null;

export const simEnabled = () => enabled;

export function setSimEnabled(on) {
  enabled = !!on;
  return enabled;
}

function tick() {
  if (!enabled) return;
  try {
    const waiting = db.prepare(`SELECT id, checked_in_at FROM appointments WHERE status = 'waiting_room' ORDER BY checked_in_at`).all();
    const roomed = db.prepare(`SELECT id, room_id, roomed_at FROM appointments WHERE status = 'roomed'`).all();
    const emptyRooms = db.prepare(`SELECT id FROM rooms WHERE status = 'empty'`).all();
    const dirtyRooms = db.prepare(`SELECT id FROM rooms WHERE status = 'needs_cleaning'`).all();
    const activeFlags = db.prepare(`SELECT id, created_at, taken_by FROM staff_requests WHERE resolved_at IS NULL`).all();

    // The EMR feed: patients arrive on the board already checked in. The
    // board never owns scheduling — in production this comes from the EMR's
    // check-in event; here the sim plays the EMR. Occasionally a couple
    // checks in together (same last initial, shared party_id).
    if (waiting.length < PACE.maxWaiting && chance(0.45)) {
      const apptTime = new Date(Date.now() + randInt(-10, 15) * 60_000).toISOString();
      const first = svc.createPatientWithAppointment({ appt_time: apptTime });
      svc.checkIn(first.appointment_id);
      if (chance(0.2) && waiting.length + 1 < PACE.maxWaiting) {
        const partner = svc.createPatientWithAppointment({
          appt_time: apptTime,
          last_initial: first.last_initial,
          party_id: first.appointment_id,
        });
        db.prepare(`UPDATE appointments SET party_id = ? WHERE id = ?`)
          .run(first.appointment_id, first.appointment_id);
        svc.checkIn(partner.appointment_id);
      }
    }

    // Rooming: longest-waiting patient. If their partner is already in a
    // room with space, seat them together; otherwise take an open room.
    if (waiting.length > 0 && chance(0.6)) {
      const next = db.prepare(`SELECT id, party_id FROM appointments WHERE id = ?`).get(waiting[0].id);
      const partnerRoom = next.party_id == null ? null : db.prepare(`
        SELECT room_id FROM appointments
        WHERE party_id = ? AND id != ? AND status = 'roomed'
          AND (SELECT COUNT(*) FROM appointments o
               WHERE o.room_id = appointments.room_id AND o.status IN ('roomed','ready_for_checkout')) < 2
      `).get(next.party_id, next.id);
      if (partnerRoom?.room_id != null) {
        svc.assignRoom(next.id, partnerRoom.room_id);
      } else if (emptyRooms.length > 0) {
        svc.assignRoom(next.id, pick(emptyRooms).id);
      }
    }

    // Occasionally a room raises a request flag.
    if (roomed.length > 0 && chance(0.2)) {
      const target = pick(roomed);
      svc.raiseFlag(target.room_id, pick(REQUEST_TYPES));
    }

    // Staff work the flags down: first someone takes the request, then it
    // gets resolved (mirrors real front-desk acknowledge-then-handle flow).
    for (const f of activeFlags) {
      if (!f.taken_by && ageSeconds(f.created_at) > PACE.minFlagClaimSeconds && chance(0.5)) {
        svc.claimFlag(f.id);
      } else if (f.taken_by && ageSeconds(f.created_at) > PACE.minFlagAgeSeconds && chance(0.45)) {
        svc.resolveFlag(f.id);
      }
    }

    // Visits wrap up: checkout frees the room (sometimes flagged for cleaning).
    for (const a of roomed) {
      if (ageSeconds(a.roomed_at) > PACE.minVisitSeconds && chance(0.3)) {
        svc.checkout(a.id, { needsCleaning: chance(0.6) });
        break; // at most one per tick keeps the board readable
      }
    }

    // Housekeeping turns dirty rooms around.
    if (dirtyRooms.length > 0 && chance(0.5)) {
      svc.markRoomClean(pick(dirtyRooms).id);
    }
  } catch (err) {
    // A failed sim action (e.g. a race with a manual click) must never kill the loop.
    console.warn(`[sim ${nowIso()}]`, err.message);
  }
}

export function startSimLoop() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
}
