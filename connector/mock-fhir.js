// In-process fake eClinicalWorks for testing the connector end-to-end with
// no network access: SMART discovery, a token endpoint that VERIFIES the
// client-assertion JWT against the real published jwks.json, and a Bulk Data
// export serving fixture patients. Synthetic data only.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4910;
const BASE = `http://localhost:${PORT}`;
const FHIR = `${BASE}/fhir/r4/MOCK`;

function verifyClientAssertion(assertion) {
  const jwks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'jwks.json'), 'utf8'));
  const [headerB64, payloadB64, sigB64] = assertion.split('.');
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error(`no JWK with kid ${header.kid}`);
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify(
    'sha384',
    Buffer.from(`${headerB64}.${payloadB64}`),
    publicKey,
    Buffer.from(sigB64, 'base64url'),
  );
  if (!ok) throw new Error('JWT signature verification failed');
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  if (payload.exp < Date.now() / 1000) throw new Error('JWT expired');
  return payload;
}

// Fixtures: two active arrivals and one already-finished visit, all "today".
function fixtures() {
  const today = new Date();
  const at = (h, m) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m).toISOString();
  const patients = [
    { resourceType: 'Patient', id: 'p1', name: [{ given: ['Anna'], family: 'Bell' }] },
    { resourceType: 'Patient', id: 'p2', name: [{ given: ['Omar'], family: 'Vance' }] },
    { resourceType: 'Patient', id: 'p3', name: [{ given: ['June'], family: 'Katz' }] },
  ];
  const practitioners = [
    { resourceType: 'Practitioner', id: 'd1', name: [{ family: 'Falk', prefix: ['Dr.'] }] },
  ];
  const phase2 = process.env.MOCK_PHASE === '2';
  const encounters = [
    // phase 1: Anna is arrived; phase 2: her visit has finished
    { resourceType: 'Encounter', id: 'e1', status: phase2 ? 'finished' : 'arrived', period: { start: at(9, 5) }, subject: { reference: 'Patient/p1' }, participant: [{ individual: { reference: 'Practitioner/d1' } }] },
    { resourceType: 'Encounter', id: 'e2', status: 'in-progress', period: { start: at(9, 20) }, subject: { reference: 'Patient/p2' }, participant: [{ individual: { reference: 'Practitioner/d1' } }] },
    // finished before the connector ever saw it: must never appear on the board
    { resourceType: 'Encounter', id: 'e3', status: 'finished', period: { start: at(8, 0) }, subject: { reference: 'Patient/p3' }, participant: [{ individual: { reference: 'Practitioner/d1' } }] },
  ];
  return { patients, practitioners, encounters };
}

const ndjson = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

export function startMockEcw() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, BASE);
      const send = (status, body, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(typeof body === 'string' ? body : JSON.stringify(body));
      };

      if (url.pathname.endsWith('/.well-known/smart-configuration')) {
        return send(200, { token_endpoint: `${BASE}/oauth/token` });
      }
      if (url.pathname === '/oauth/token' && req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        try {
          verifyClientAssertion(new URLSearchParams(raw).get('client_assertion') || '');
          return send(200, { access_token: 'mock-token', token_type: 'bearer', expires_in: 3600 });
        } catch (err) {
          return send(401, { error: 'invalid_client', error_description: err.message });
        }
      }
      if (req.headers.authorization !== 'Bearer mock-token') {
        return send(401, { error: 'unauthorized' });
      }
      if (url.pathname.includes('/Group/') && url.pathname.endsWith('/$export')) {
        return send(202, '', { 'Content-Location': `${BASE}/bulk/status` });
      }
      if (url.pathname === '/bulk/status') {
        return send(200, {
          transactionTime: new Date().toISOString(),
          output: [
            { type: 'Patient', url: `${BASE}/bulk/files/patients` },
            { type: 'Encounter', url: `${BASE}/bulk/files/encounters` },
            { type: 'Practitioner', url: `${BASE}/bulk/files/practitioners` },
          ],
        });
      }
      if (url.pathname.startsWith('/bulk/files/')) {
        const { patients, practitioners, encounters } = fixtures();
        const file = url.pathname.split('/').pop();
        const rows = { patients, encounters, practitioners }[file];
        if (rows) return send(200, ndjson(rows), { 'Content-Type': 'application/fhir+ndjson' });
      }
      send(404, { error: 'not found' });
    });
    server.unref();
    server.listen(PORT, () => resolve(FHIR));
  });
}
