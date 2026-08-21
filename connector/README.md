# Pluff eCW Connector

Reads patient arrivals from an eClinicalWorks FHIR R4 endpoint (SMART Backend
Services + Bulk Data) and feeds them to the Pluff board, replacing the demo
simulation with the practice's real check-in flow.

## What it does, each poll

1. Authenticates to eCW using SMART Backend Services: builds a short-lived
   JWT signed with Pluff's private key (`RS384`, kid `pluff-key-2026-08` —
   public half published at https://pluff.health/jwks.json) and exchanges it
   for an access token.
2. Kicks off a Bulk Data export on the configured patient Group:
   `GET {FHIR_BASE}/Group/{GROUP_ID}/$export?_type=Encounter,Patient,Practitioner&_since=...`
3. Polls the export status, downloads the NDJSON files.
4. Keeps only today's Encounters, maps them to minimal arrival records
   (patient first name + last initial, provider name, arrival time, status —
   nothing clinical), and POSTs them to the board's `/api/sync/arrivals`.
   The board creates + checks in new arrivals and checks out ended visits.
   Room assignment stays a human decision at the front desk.

## Configuration (environment variables)

| Variable | Meaning | Example |
|---|---|---|
| `ECW_FHIR_BASE` | Sandbox/production FHIR base (the "Issuer URL" from the developer portal) | `https://staging-fhir.ecwcloud.com/fhir/r4/FFBJCD` |
| `ECW_CLIENT_ID` | App Client ID from the developer portal | `PxYXS74Mla...` |
| `ECW_PRIVATE_KEY_PATH` | Path to `pluff-private-key.pem` (never committed) | `./pluff-private-key.pem` |
| `ECW_GROUP_ID` | Patient Group to export (from Bulk Group Details) | `1e7302da-...` ("All Patient") |
| `BOARD_URL` | Where the Pluff board server runs | `http://localhost:4000` |
| `SYNC_TOKEN` | Optional shared secret; must match the board server's env | |
| `POLL_MINUTES` | Poll interval (default 10) | `10` |

Run once: `node connector/index.js --once` · Run continuously: `npm run connector`

## Mock mode (no eCW needed)

`npm run connector:mock` starts an in-process fake eCW (SMART discovery,
token endpoint that **verifies the real JWT signature against the published
jwks.json**, Bulk export with fixture patients) and runs one full poll
against the local board. Run the board first with the simulation off:
`SIM_DEFAULT=off npm start`.

## Deliberate limitations

- Reads only Encounter/Patient/Practitioner; the board's patient panel shows
  placeholder DOB/phone because the connector does not fetch them — minimum
  necessary by design.
- The connector never writes to eClinicalWorks.
