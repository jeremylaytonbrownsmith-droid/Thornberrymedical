# Meridian — Patient Flow Board (Demo)

A live "big board" for a small medical practice front desk: which exam rooms are
occupied and for how long, who is in the waiting room, and which rooms need
attention — plus the staff workflow to check patients in, room them, flag
requests, and check them out.

> **Demo only. All patient data is synthetic.** Names, DOBs, and phone numbers
> are generated from fake pools (phones use the reserved 555-01xx range). There
> is no real PHI anywhere in this project, and it connects to no external
> system — it runs entirely offline.

![Stack](https://img.shields.io/badge/stack-Node%20%2B%20Express%20%2B%20SQLite%20%2B%20React-35c2b0)

## Quick start

```bash
npm install        # installs server + client deps (client via postinstall)
npm run dev        # starts API on :4000 and the UI on http://localhost:5173
```

Open **http://localhost:5173**. The simulation is on by default, so the board
starts moving on its own within a few seconds.

Production-style single process (serves the built UI from the API port):

```bash
npm run build
npm start          # everything on http://localhost:4000
```

## Sharing the demo (no server needed)

`standalone/meridian-demo.html` is a single-file, self-contained version of
the whole demo — same board, same workflow, same simulation — ported to run
entirely in the browser with in-memory state. It has no dependencies and no
backend: send the file to anyone (or host it on any static host / open it
from a phone's Files app) and it just runs. It's mobile-first: entities open
a bottom sheet with touch-sized action buttons instead of dropdowns. Each
viewer gets their own private clinic; nothing is stored or transmitted.

The full app below is the real architecture (server-backed, shared state
across screens — what a clinic would actually run on a wall board plus front
desk). The standalone file is the "text someone a link" version.

## Using the board

- **Exam rooms** — each card shows the occupant (first name + last initial
  only, modeling good privacy practice), appointment time, provider, and a
  live **time-in-room** counter. The counter and card edge are green while on
  time, amber past 10 minutes, red past 20 (thresholds in
  `client/src/config.js`).
- **Flags** — `+ Flag` on an occupied room raises a request (patient waiting,
  needs assistance, needs supplies, ready for provider, checkout ready). Flags
  show as colored chips; the ✓ resolves them. A "needs assistance" flag turns
  the whole card red.
- **Waiting room** — everyone checked in but not yet roomed, with live wait
  times. Use **Assign room…** to move them into any open room.
- **Up next** — the schedule. **Check in** moves a patient to the waiting
  room; **+ Add walk-in** creates and checks in an unscheduled patient.
- **Checkout** — *Ready for checkout* → *Complete checkout* frees the room
  (usually to *needs cleaning*, then **Mark clean** reopens it).
- **Patient panel** — click any room card, waiting-room row, or schedule entry
  to see the patient's (fake) details: reason for visit, provider, DOB, phone.

## Simulation mode

The **Simulation on/off** toggle in the header controls a server-side loop
(`server/sim.js`, ticks every 4 s) that keeps the demo alive: it books new
synthetic patients, checks them in, rooms them, raises and resolves random
flags, and checks them out — time-compressed so the board visibly changes
every few seconds. Manual controls work at all times, sim on or off; both
paths go through the same transition functions (`server/services.js`), so the
sim can never put the board in a state staff couldn't reach by hand.

- Toggle via UI, or: `curl -X POST localhost:4000/api/sim -H 'Content-Type: application/json' -d '{"enabled":false}'`
- Pacing/probabilities are constants at the top of `server/sim.js`.

## Reset / reseed

- **UI:** the *Reset demo* button in the header (asks for confirmation).
- **API:** `curl -X POST localhost:4000/api/reset`
- **Full wipe:** stop the server and delete `server/data/` — it reseeds on boot.

Reseeding creates 6 rooms, a fresh schedule, a few patients already waiting,
and three already roomed with staggered times (3/12/24 min) so the
green/amber/red states are all visible immediately.

## Verifying it works

With the server running:

```bash
npm run verify
```

`scripts/verify-lifecycle.mjs` pauses the sim, reseeds, then drives the full
lifecycle over the HTTP API — walk-in → check-in → room → flag → resolve →
ready → checkout → room freed → cleaned — asserting statuses, timestamps, and
that double-booking a room is rejected. It then re-enables the sim and samples
the board for ~65 s to confirm it changes on its own without draining or
getting stuck.

## Data model (SQLite, `server/data/clinic.db`)

| Table | Purpose | Key columns |
|---|---|---|
| `patients` | Synthetic people | `first_name`, `last_initial`, `date_of_birth`, `reason_for_visit`, `phone` |
| `appointments` | One visit; carries the workflow state | `status` (`scheduled → waiting_room → roomed → ready_for_checkout → checked_out`), `room_id`, `checked_in_at`, `roomed_at`, `checked_out_at`, `is_walk_in` |
| `rooms` | Exam rooms | `name`, `status` (`empty` / `occupied` / `needs_cleaning`), `current_appointment_id` |
| `staff_requests` | Request/status flags on a room | `request_type`, `created_at`, `resolved_at` (open = `resolved_at IS NULL`) |

State transitions live in `server/services.js` and validate preconditions
(can't room someone who isn't waiting, can't double-book a room, checkout
always clears the room's occupant and resolves its open flags — so rooms can't
get "stuck").

### API surface

```
GET  /api/state                          whole board in one call (UI polls every 3 s)
POST /api/patients                       add + check in a walk-in
POST /api/appointments/:id/checkin       scheduled → waiting_room
POST /api/appointments/:id/room          waiting_room → roomed   {room_id}
POST /api/appointments/:id/ready-checkout
POST /api/appointments/:id/checkout      frees the room
POST /api/rooms/:id/clean                needs_cleaning → empty
POST /api/rooms/:id/flags                raise a flag            {request_type}
POST /api/flags/:id/resolve
POST /api/sim                            {enabled: true|false}
POST /api/reset                          wipe + reseed
```

## Project layout

```
server/   Express API, SQLite layer, seed data, simulation loop
client/   React (Vite) board UI — polls /api/state, ticks timers locally
scripts/  verify-lifecycle.mjs end-to-end check
```

## Before anything like this touches real patients

This prototype deliberately stops at the demo line: no real scheduling/EHR
integration, no SMS, no authentication, no hosting story. Moving past a demo
would mean revisiting HIPAA obligations (BAAs, access control, audit logging,
encryption at rest/in transit) and deciding local-network vs. cloud hosting —
none of which is set up here, on purpose.
