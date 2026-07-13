// End-to-end lifecycle verification against a running server (default :4000).
// Usage: npm run verify   (server must already be running)
const BASE = process.env.BASE_URL || 'http://localhost:4000';

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}`);
  if (!cond) failures += 1;
};

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${data.error}`);
  return data;
}
const get = (p) => req('GET', p);
const post = (p, b) => req('POST', p, b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('— Manual lifecycle (sim paused so nothing races us) —');
await post('/api/sim', { enabled: false });
await post('/api/reset');

let state = await get('/api/state');
ok(state.rooms.length === 6, `reseed: ${state.rooms.length} rooms created`);
ok(state.scheduled.length > 0, `reseed: ${state.scheduled.length} scheduled patients`);
ok(state.waiting.length > 0, `reseed: ${state.waiting.length} in waiting room`);
ok(state.rooms.some((r) => r.status === 'occupied'), 'reseed: some rooms occupied');

// 1. Walk-in patient is created and lands in the waiting room, timestamped.
const walkIn = await post('/api/patients', { first_name: 'Verity', last_initial: 'Q', reason_for_visit: 'E2E test visit' });
ok(walkIn.status === 'waiting_room', `walk-in check-in -> status '${walkIn.status}'`);
ok(!!walkIn.checked_in_at, `checked_in_at stamped (${walkIn.checked_in_at})`);
const apptId = walkIn.id;

// 2. Scheduled patient can also be checked in.
state = await get('/api/state');
const sched = state.scheduled[0];
const checkedIn = await post(`/api/appointments/${sched.appointment_id}/checkin`);
ok(checkedIn.status === 'waiting_room', 'scheduled patient check-in works');

// 3. Assign the walk-in to an open room.
state = await get('/api/state');
const openRoom = state.rooms.find((r) => r.status === 'empty');
ok(!!openRoom, `an open room exists (${openRoom?.name})`);
const roomed = await post(`/api/appointments/${apptId}/room`, { room_id: openRoom.id });
ok(roomed.status === 'roomed' && roomed.room_id === openRoom.id, 'assign to room -> roomed');
ok(!!roomed.roomed_at, `roomed_at stamped (${roomed.roomed_at})`);
state = await get('/api/state');
const roomNow = state.rooms.find((r) => r.id === openRoom.id);
ok(roomNow.status === 'occupied' && roomNow.appointment_id === apptId, 'room shows occupied + linked appointment');
ok(state.waiting.every((w) => w.appointment_id !== apptId), 'walk-in left the waiting list');

// 4. Double-booking the same room must fail.
let doubleBookRejected = false;
try {
  await post(`/api/appointments/${sched.appointment_id}/room`, { room_id: openRoom.id });
} catch { doubleBookRejected = true; }
ok(doubleBookRejected, 'assigning a second patient to an occupied room is rejected');

// 5. Raise and resolve a flag.
const flag = await post(`/api/rooms/${openRoom.id}/flags`, { request_type: 'needs_assistance' });
state = await get('/api/state');
ok(state.rooms.find((r) => r.id === openRoom.id).flags.some((f) => f.id === flag.id), 'flag appears on the room');
const resolved = await post(`/api/flags/${flag.id}/resolve`);
ok(!!resolved.resolved_at, 'flag resolves with timestamp');

// 6. Checkout: ready -> checked out, room frees up.
const ready = await post(`/api/appointments/${apptId}/ready-checkout`);
ok(ready.status === 'ready_for_checkout', 'ready-for-checkout works');
const out = await post(`/api/appointments/${apptId}/checkout`);
ok(out.status === 'checked_out' && !!out.checked_out_at, `checkout stamped (${out.checked_out_at})`);
state = await get('/api/state');
const freed = state.rooms.find((r) => r.id === openRoom.id);
ok(freed.status === 'needs_cleaning' && freed.current_appointment_id == null, 'room freed (needs_cleaning), no lingering occupant');
ok(freed.flags.length === 0, 'no stale flags on the freed room');
const cleaned = await post(`/api/rooms/${openRoom.id}/clean`);
ok(cleaned.status === 'empty', 'mark-clean returns room to empty');

// 7. Sanity: no negative/garbage elapsed times anywhere.
state = await get('/api/state');
const now = Date.now();
const badTs = [
  ...state.waiting.map((w) => w.checked_in_at),
  ...state.rooms.filter((r) => r.roomed_at).map((r) => r.roomed_at),
].filter((ts) => !(new Date(ts).getTime() <= now + 1000));
ok(badTs.length === 0, 'all check-in/roomed timestamps are valid and non-future');

console.log('\n— Simulation loop (watching the board run itself) —');
await post('/api/sim', { enabled: true });
const snapshot = (s) => ({
  occupied: s.rooms.filter((r) => r.status === 'occupied').length,
  waiting: s.waiting.length,
  scheduled: s.scheduled.length,
  flags: s.rooms.reduce((n, r) => n + r.flags.length, 0),
  checkedOut: s.checkedOutToday,
});
const samples = [snapshot(await get('/api/state'))];
for (let i = 0; i < 8; i++) {
  await sleep(8000);
  samples.push(snapshot(await get('/api/state')));
}
samples.forEach((s, i) => console.log(`  t+${i * 8}s`, JSON.stringify(s)));
const changed = samples.some((s) => JSON.stringify(s) !== JSON.stringify(samples[0]));
ok(changed, 'board state changes on its own while sim runs');
ok(samples.some((s) => s.checkedOut > samples[0].checkedOut) || samples.some((s) => s.occupied !== samples[0].occupied),
  'patients cycle through (checkouts or room occupancy changed)');
const last = samples[samples.length - 1];
ok(last.occupied > 0 || last.waiting > 0, 'clinic still active at end (nothing drained to zero)');

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
