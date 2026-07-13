// Pluff — database layer. SQLite via better-sqlite3, file-based, zero setup.
// ALL data in this system is synthetic. There are no real patients and no PHI.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'clinic.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_initial TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  reason_for_visit TEXT NOT NULL,
  phone TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'empty'
    CHECK (status IN ('empty','occupied','needs_cleaning')),
  current_appointment_id INTEGER REFERENCES appointments(id)
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  appt_time TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','checked_in','waiting_room','roomed','ready_for_checkout','checked_out')),
  room_id INTEGER REFERENCES rooms(id),
  is_walk_in INTEGER NOT NULL DEFAULT 0,
  checked_in_at TEXT,
  roomed_at TEXT,
  checked_out_at TEXT
);

CREATE TABLE IF NOT EXISTS staff_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  request_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  taken_by TEXT,
  resolved_at TEXT
);
`);

// Databases created before the claim/"taken by" feature lack the column.
try {
  db.exec('ALTER TABLE staff_requests ADD COLUMN taken_by TEXT');
} catch {
  // column already exists
}

export const nowIso = () => new Date().toISOString();
