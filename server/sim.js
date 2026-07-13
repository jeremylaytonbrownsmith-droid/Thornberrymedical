// Demo simulation loop. When enabled, it walks synthetic patients through the
// full lifecycle on a timer (time-compressed, so the board visibly changes
// within seconds) while leaving every manual control fully usable.
import { db, nowIso } from './db.js';
import * as svc from './services.js';
import { pick, randInt } from './fake.js';

const TICK_MS = 4000;

// Time-compressed pacing (real clinics take minutes; the demo takes seconds).
const PACE = {
  minVisitSeconds: 35,        // minimum time roomed before eligible for checkout-ready
  minReadySeconds: 12,        // minimum time in ready_for_checkout before checkout
  minFlagClaimSeconds: 8,     // sim staff claim ("take") a flag after this
  minFlagAgeSeconds: 20,      // sim only auto-resolves flags older than this
  targetScheduled: 5,         // keep this many upcoming appointments on the books
  maxWaiting: 5,
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
    const scheduled = db.prepare(`SELECT id, appt_time FROM appointments WHERE status = 'scheduled' ORDER BY appt_time`).all();
    const waiting = db.prepare(`SELECT id, checked_in_at FROM appointments WHERE status = 'waiting_room' ORDER BY checked_in_at`).all();
    const roomed = db.prepare(`SELECT id, room_id, roomed_at FROM appointments WHERE status = 'roomed'`).all();
    const ready = db.prepare(`SELECT id FROM appointments WHERE status = 'ready_for_checkout'`).all();
    const emptyRooms = db.prepare(`SELECT id FROM rooms WHERE status = 'empty'`).all();
    const dirtyRooms = db.prepare(`SELECT id FROM rooms WHERE status = 'needs_cleaning'`).all();
    const activeFlags = db.prepare(`SELECT id, created_at, taken_by FROM staff_requests WHERE resolved_at IS NULL`).all();

    // Keep the upcoming schedule stocked with fresh synthetic patients.
    if (scheduled.length < PACE.targetScheduled && chance(0.7)) {
      svc.createPatientWithAppointment({
        appt_time: new Date(Date.now() + randInt(2, 60) * 60_000).toISOString(),
      });
    }

    // Front desk checks someone in (soonest appointment first).
    if (scheduled.length > 0 && waiting.length < PACE.maxWaiting && chance(0.5)) {
      svc.checkIn(scheduled[0].id);
    }

    // Rooming: longest-waiting patient into a random open room.
    if (waiting.length > 0 && emptyRooms.length > 0 && chance(0.6)) {
      svc.assignRoom(waiting[0].id, pick(emptyRooms).id);
    }

    // Occasionally a room raises a request flag.
    if (roomed.length > 0 && chance(0.2)) {
      const target = pick(roomed);
      svc.raiseFlag(target.room_id, pick(['patient_waiting', 'needs_assistance', 'needs_supplies', 'ready_for_provider']));
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

    // Visits wrap up: roomed -> ready_for_checkout.
    for (const a of roomed) {
      if (ageSeconds(a.roomed_at) > PACE.minVisitSeconds && chance(0.35)) {
        svc.readyForCheckout(a.id);
        break; // at most one per tick keeps the board readable
      }
    }

    // Checkout completes and frees the room (sometimes flagged for cleaning).
    if (ready.length > 0 && chance(0.5)) {
      svc.checkout(ready[0].id, { needsCleaning: chance(0.6) });
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
