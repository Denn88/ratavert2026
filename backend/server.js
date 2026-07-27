const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

// DATA_DIR lets you point the database at a mounted persistent volume in
// production (e.g. Railway's /data volume) so it survives redeploys.
// Defaults to this folder for local development.
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "ratavert.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    username    TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'user',
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS device (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    ip            TEXT,
    owner         TEXT,
    online        INTEGER NOT NULL DEFAULT 0,
    armed_lights  INTEGER NOT NULL DEFAULT 1,
    armed_audio   INTEGER NOT NULL DEFAULT 1,
    armed_pepper  INTEGER NOT NULL DEFAULT 1,
    armed_last    INTEGER NOT NULL DEFAULT 1,
    last_seen     TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    detecting           INTEGER NOT NULL DEFAULT 1,
    detection_interval  INTEGER NOT NULL DEFAULT 20
  );

  CREATE TABLE IF NOT EXISTS detections (
    id          TEXT PRIMARY KEY,
    timestamp   TEXT NOT NULL,
    confidence  REAL,
    photo_path  TEXT,
    actions_fired TEXT NOT NULL DEFAULT '[]',
    escalated   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trigger_events (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    source        TEXT NOT NULL,          -- 'auto' | 'manual'
    is_rat        INTEGER NOT NULL DEFAULT 0,
    is_last       INTEGER NOT NULL DEFAULT 0,
    detail        TEXT,
    requested_by  TEXT,
    detection_id  TEXT,
    confidence    REAL,
    fired_at      TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS commands (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    duration    INTEGER NOT NULL DEFAULT 2,
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending | delivered | done
    trigger_event_id TEXT,
    created_at  TEXT NOT NULL
  );

  -- Stored, point-in-time snapshots — NOT computed live. Generated once,
  -- automatically, every Sunday at 00:00, then frozen. This is the "weekly
  -- report the user's IoT device sends to the admin," distinct from that
  -- user's own always-live Activity page.
  CREATE TABLE IF NOT EXISTS weekly_reports (
    id                  TEXT PRIMARY KEY,
    device_owner        TEXT,               -- username this device is bound to
    device_ip           TEXT,
    period_since        TEXT NOT NULL,
    period_until        TEXT NOT NULL,
    generated_at        TEXT NOT NULL,
    detections_total    INTEGER NOT NULL DEFAULT 0,
    detections_escalated INTEGER NOT NULL DEFAULT 0,
    deterrence_json     TEXT NOT NULL DEFAULT '{}',
    entries_json        TEXT NOT NULL DEFAULT '[]'
  );
`);

// Migration: add columns used by manual (browser-webcam) test captures,
// which share the detections table with real Pi detections but are tagged
// distinctly so they never count toward rat-detection analytics.
const detectionCols = db.prepare("PRAGMA table_info(detections)").all().map((c) => c.name);
if (!detectionCols.includes("source")) {
  db.exec("ALTER TABLE detections ADD COLUMN source TEXT NOT NULL DEFAULT 'device'");
}
if (!detectionCols.includes("captured_by")) {
  db.exec("ALTER TABLE detections ADD COLUMN captured_by TEXT");
}

// Seed singleton rows
const deviceRow = db.prepare("SELECT * FROM device WHERE id = 1").get();
if (!deviceRow) {
  db.prepare(
    `INSERT INTO device (id, ip, owner, online, armed_lights, armed_audio, armed_pepper, armed_last, last_seen)
     VALUES (1, NULL, NULL, 0, 1, 1, 1, 1, NULL)`
  ).run();
}
const settingsRow = db.prepare("SELECT * FROM settings WHERE id = 1").get();
if (!settingsRow) {
  db.prepare(
    `INSERT INTO settings (id, detecting, detection_interval) VALUES (1, 1, 20)`
  ).run();
}

// Seed a first admin account only if the accounts table is completely empty
const accountCount = db.prepare("SELECT COUNT(*) AS c FROM accounts").get().c;
if (accountCount === 0) {
  const username = (process.env.SEED_ADMIN_USERNAME || "admin").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || "change_me_immediately";
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    `INSERT INTO accounts (username, password_hash, role, active, created_at) VALUES (?,?,?,1,?)`
  ).run(username, hash, "admin", new Date().toISOString());
  console.log(`[seed] Created initial admin account "${username}". Change its password after first login.`);
}

module.exports = db;
