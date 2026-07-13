# Pluff — Patient Flow Board (Demo)

A live "big board" for a small medical practice front desk. The model matches
how these boards are used in real clinics: **the EMR owns scheduling and
check-in; the board's job starts when a patient is checked in.** Checked-in
patients appear in a queue, staff place them in a room, rooms show who's in
them and for how long, and request flags surface what needs attention.

In production the checked-in queue would be fed by the practice's EMR
(check-in event via its API or an HL7 ADT/FHIR feed). This demo has no EMR to
talk to, so the simulation plays the EMR's role — it's labeled that way on
screen — and a manual "add patient" fallback covers walk-ins or an EMR outage.

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

## Live demo

The shareable demo is published via GitHub Pages:

**https://jeremylaytonbrownsmith-droid.github.io/Thornberrymedical/**

GitHub Pages serves this branch's root, where `index.html` is a copy of
`standalone/pluff-demo.html` kept in sync by
`.github/workflows/deploy-demo.yml`. Synthetic data only — safe to share
publicly.

## Sharing the demo (no server needed)

`standalone/pluff-demo.html` is a single-file, self-contained version of
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
- **Flags** — `+ Flag` on an occupied room raises a request. The set is
  tuned for a podiatry practice (patient waiting, needs assistance, needs
  supplies, needs injection, needs X-ray, wound care, procedure setup, boot
  fitting, orthotics casting, ready for provider, checkout ready) and lives in
  `server/fake.js` + `client/src/config.js`, so it's easy to extend. Flags
  show as colored chips with a live **elapsed timer** (how long the request has
  been open). **Take** claims the request under a staff member's name —
  acknowledge first, resolve second, so the board always shows who owns an open
  request — and ✓ resolves it. A "needs assistance" flag turns the whole card
  red.
- **Light / dark board** — light is the default (clinics are bright places);
  the header toggle switches to a dark board for dim rooms. The choice is
  remembered per browser.
- **Chime** — the header bell toggles a soft two-note chime whenever a new
  request flag is raised, so front desk staff hear the board without watching
  it (off by default).
- **Checked in** — the queue of patients who have been checked in (fed from
  the EMR in a real clinic; the simulation plays that role here), with live
  wait times. Pick a room from the dropdown to place them — that's the core
  staff action. **+ Add patient manually** covers walk-ins or an EMR outage.
- **Checkout** — one button frees the room (usually to *needs cleaning*,
  then **Mark clean** reopens it).
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

Reseeding creates 4 rooms, a fresh schedule, a few patients already waiting,
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
| `appointments` | One visit; carries the workflow state | `status` (`scheduled → waiting_room → roomed → checked_out`; the board displays from `waiting_room` on — `scheduled` belongs to the EMR, and `ready_for_checkout` remains supported in the API), `room_id`, `checked_in_at`, `roomed_at`, `checked_out_at`, `is_walk_in` |
| `rooms` | Exam rooms | `name`, `status` (`empty` / `occupied` / `needs_cleaning`), `current_appointment_id` |
| `staff_requests` | Request/status flags on a room | `request_type`, `created_at`, `taken_by` (who claimed it), `resolved_at` (open = `resolved_at IS NULL`) |

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
POST /api/flags/:id/claim                take a request          {name?} (random staff if omitted)
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
integration, no SMS, no authentication, no hosting story. The single most
important real-world step is replacing the simulated feed with the practice's
EMR check-in event.

**Target EMR: eClinicalWorks (eCW).** The practice plans to use eCW, which
offers several viable paths for the check-in feed, roughly in order of
preference:

1. **FHIR R4 API** via the eCW developer program (app registration required).
   A small connector polls today's appointments every 30–60 s and fires the
   board's check-in call when a patient's status changes to "Arrived" (the
   front desk's normal eCW workflow is the trigger — no new steps for staff).
2. **Event/webhook subscriptions** where available in eCW's platform —
   push instead of poll; confirm availability and scope with eCW.
3. **HL7 v2 interface (SIU/ADT)** through eCW's interface team — the
   old-school reliable option; eCW typically charges interface setup and
   maintenance fees.

Questions to settle with the eCW rep (ideally in writing, during contract
negotiation when leverage is highest): does the plan include third-party
API access; can an app read today's appointment statuses; what does an HL7
SIU/ADT interface cost. Note eCW is cloud-hosted, so the connector talks to
eCW over the internet regardless of where the board itself is hosted. Moving past a demo also means
revisiting HIPAA obligations (BAAs, access control, audit logging, encryption
at rest/in transit) and deciding local-network vs. cloud hosting — none of
which is set up here, on purpose.
