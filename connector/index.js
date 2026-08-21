// Pluff eCW connector — SMART Backend Services + FHIR Bulk Data client.
// Reads today's arrivals from eClinicalWorks and syncs them to the board.
// Zero dependencies: Node 18+ built-ins only (crypto, fetch, fs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const once = process.argv.includes('--once');
const mock = process.env.ECW_MOCK === '1';

const cfg = {
  fhirBase: process.env.ECW_FHIR_BASE,
  clientId: process.env.ECW_CLIENT_ID,
  privateKeyPath: process.env.ECW_PRIVATE_KEY_PATH || path.join(__dirname, 'pluff-private-key.pem'),
  kid: process.env.ECW_KID || 'pluff-key-2026-08',
  groupId: process.env.ECW_GROUP_ID,
  boardUrl: process.env.BOARD_URL || 'http://localhost:4000',
  syncToken: process.env.SYNC_TOKEN || '',
  pollMinutes: Number(process.env.POLL_MINUTES || 10),
  scopes: 'system/Patient.read system/Encounter.read system/Practitioner.read system/Group.read',
};

const statePath = path.join(__dirname, 'state.json');
const loadState = () => {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return {}; }
};
const saveState = (s) => fs.writeFileSync(statePath, JSON.stringify(s, null, 2));

const b64u = (input) => Buffer.from(input).toString('base64url');

// ---------- SMART Backend Services auth ----------

function buildClientAssertion(tokenEndpoint) {
  const privateKey = fs.readFileSync(cfg.privateKeyPath, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS384', typ: 'JWT', kid: cfg.kid };
  const payload = {
    iss: cfg.clientId,
    sub: cfg.clientId,
    aud: tokenEndpoint,
    iat: now,
    exp: now + 300,
    jti: crypto.randomUUID(),
  };
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const signature = crypto.sign('sha384', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${b64u(signature)}`;
}

async function discoverTokenEndpoint() {
  const res = await fetch(`${cfg.fhirBase}/.well-known/smart-configuration`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`smart-configuration ${res.status}`);
  const conf = await res.json();
  if (!conf.token_endpoint) throw new Error('smart-configuration has no token_endpoint');
  return conf.token_endpoint;
}

async function getAccessToken() {
  const tokenEndpoint = await discoverTokenEndpoint();
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: cfg.scopes,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: buildClientAssertion(tokenEndpoint),
  });
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${await res.text()}`);
  const tok = await res.json();
  if (!tok.access_token) throw new Error('no access_token in token response');
  return tok.access_token;
}

// ---------- FHIR Bulk Data export ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runBulkExport(token, since) {
  const params = new URLSearchParams({ _type: 'Encounter,Patient,Practitioner' });
  if (since) params.set('_since', since);
  const kickoff = await fetch(`${cfg.fhirBase}/Group/${cfg.groupId}/$export?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/fhir+json',
      Prefer: 'respond-async',
    },
  });
  if (kickoff.status !== 202) throw new Error(`$export kickoff ${kickoff.status}: ${await kickoff.text()}`);
  const statusUrl = kickoff.headers.get('content-location');
  if (!statusUrl) throw new Error('$export kickoff returned no Content-Location');

  let manifest = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const res = await fetch(statusUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (res.status === 200) { manifest = await res.json(); break; }
    if (res.status !== 202) throw new Error(`$export status ${res.status}: ${await res.text()}`);
    const retryAfter = Number(res.headers.get('retry-after') || 2);
    await sleep(Math.min(retryAfter, 15) * 1000);
  }
  if (!manifest) throw new Error('$export did not complete in time');

  const byType = { Patient: [], Encounter: [], Practitioner: [] };
  for (const file of manifest.output ?? []) {
    if (!byType[file.type]) continue;
    const res = await fetch(file.url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/fhir+ndjson' },
    });
    if (!res.ok) throw new Error(`ndjson download ${res.status} for ${file.type}`);
    const text = await res.text();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) byType[file.type].push(JSON.parse(trimmed));
    }
  }
  return byType;
}

// ---------- transform: FHIR resources -> minimal arrival records ----------

const ACTIVE_STATUSES = new Set(['arrived', 'triaged', 'in-progress']);
const ENDED_STATUSES = new Set(['finished', 'cancelled', 'entered-in-error']);

function humanName(resource) {
  const name = resource?.name?.[0];
  if (!name) return { first: 'Unknown', lastInitial: 'X' };
  const first = (name.given?.[0] || name.text?.split(' ')?.[0] || 'Unknown').trim();
  const family = (name.family || '').trim();
  return { first, lastInitial: (family[0] || 'X').toUpperCase() };
}

function practitionerDisplay(resource) {
  const name = resource?.name?.[0];
  if (!name) return 'Provider';
  const family = name.family || name.text || 'Provider';
  const prefix = name.prefix?.[0];
  return prefix ? `${prefix} ${family}` : `Dr. ${family}`;
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function toArrivals({ Patient = [], Encounter = [], Practitioner = [] }) {
  const patients = new Map(Patient.map((p) => [p.id, p]));
  const practitioners = new Map(Practitioner.map((p) => [p.id, p]));
  const refId = (ref) => ref?.reference?.split('/').pop();

  const arrivals = [];
  for (const enc of Encounter) {
    const status = enc.status;
    const active = ACTIVE_STATUSES.has(status);
    const ended = ENDED_STATUSES.has(status);
    if (!active && !ended) continue;
    const start = enc.period?.start;
    if (!isToday(start)) continue;

    const patient = patients.get(refId(enc.subject));
    const { first, lastInitial } = humanName(patient);
    const practRef = enc.participant?.map((p) => refId(p.individual)).find((id) => practitioners.has(id));
    arrivals.push({
      encounter_id: enc.id,
      first_name: first,
      last_initial: lastInitial,
      provider_name: practitionerDisplay(practitioners.get(practRef)),
      appt_time: start,
      status: active ? 'active' : 'ended',
    });
  }
  return arrivals;
}

// ---------- push to the board ----------

async function pushToBoard(arrivals) {
  const res = await fetch(`${cfg.boardUrl}/api/sync/arrivals`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.syncToken ? { 'x-sync-token': cfg.syncToken } : {}),
    },
    body: JSON.stringify({ arrivals }),
  });
  if (!res.ok) throw new Error(`board sync ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------- main loop ----------

async function pollOnce() {
  const state = loadState();
  const startedAt = new Date().toISOString();
  const token = await getAccessToken();
  const resources = await runBulkExport(token, state.since);
  const arrivals = toArrivals(resources);
  const summary = arrivals.length ? await pushToBoard(arrivals) : { created: 0, completed: 0, already: 0, skipped: 0 };
  saveState({ ...state, since: startedAt, lastRun: startedAt });
  console.log(
    `[${startedAt}] encounters=${resources.Encounter.length} arrivals=${arrivals.length} ` +
    `created=${summary.created} completed=${summary.completed} unchanged=${summary.already} skipped=${summary.skipped}`
  );
}

async function main() {
  if (mock) {
    const { startMockEcw } = await import('./mock-fhir.js');
    const base = await startMockEcw();
    cfg.fhirBase = base;
    cfg.clientId = cfg.clientId || 'mock-client';
    cfg.groupId = cfg.groupId || 'mock-group';
  }
  for (const key of ['fhirBase', 'clientId', 'groupId']) {
    if (!cfg[key]) {
      console.error(`Missing configuration: ${key} (see connector/README.md)`);
      process.exit(1);
    }
  }
  if (once || mock) {
    await pollOnce();
    process.exit(0);
  }
  console.log(`Pluff connector polling every ${cfg.pollMinutes} min against ${cfg.fhirBase}`);
  for (;;) {
    try {
      await pollOnce();
    } catch (err) {
      console.error(`[${new Date().toISOString()}] poll failed: ${err.message}`);
    }
    await sleep(cfg.pollMinutes * 60 * 1000);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
