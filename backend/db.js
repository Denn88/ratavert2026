const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

// DATA_DIR lets you point the database at a mounted persistent volume in
// production (e.g. Railway's /data volume) so it survives redeploys.
// Defaults to this folder for local development.
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "ratavert.db"));
db.pragma("journal_mode = WAL");

function newDeviceKey() {
  return crypto.randomBytes(16).toString("hex");
}

// ═══════════════════════════════════════ SCHEMA ═══════════════════════════
// Every piece of activity data (devices, settings, detections, trigger
// events, commands, weekly reports) is now scoped to a single owner
// (username). Nothing is shared across accounts — including admin.
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    username    TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'user',
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL
  );

  -- One device row per account. device_key is unique per account and is
  -- what that account's own Raspberry Pi authenticates with — this is how
  -- the backend knows which account's data a given Pi's requests belong to.
  CREATE TABLE IF NOT EXISTS devices (
    owner         TEXT PRIMARY KEY REFERENCES accounts(username),
    device_key    TEXT UNIQUE NOT NULL,
    ip            TEXT,
    online        INTEGER NOT NULL DEFAULT 0,
    armed_lights  INTEGER NOT NULL DEFAULT 1,
    armed_audio   INTEGER NOT NULL DEFAULT 1,
    armed_pepper  INTEGER NOT NULL DEFAULT 1,
    armed_last    INTEGER NOT NULL DEFAULT 1,
    last_seen     TEXT
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    owner               TEXT PRIMARY KEY REFERENCES accounts(username),
    detecting           INTEGER NOT NULL DEFAULT 1,
    detection_interval  INTEGER NOT NULL DEFAULT 20
  );

  CREATE TABLE IF NOT EXISTS detections (
    id          TEXT PRIMARY KEY,
    owner       TEXT NOT NULL,
    timestamp   TEXT NOT NULL,
    confidence  REAL,
    photo_path  TEXT,
    actions_fired TEXT NOT NULL DEFAULT '[]',
    escalated   INTEGER NOT NULL DEFAULT 0,
    source      TEXT NOT NULL DEFAULT 'device',
    captured_by TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trigger_events (
    id            TEXT PRIMARY KEY,
    owner         TEXT NOT NULL,
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
    owner       TEXT NOT NULL,
    type        TEXT NOT NULL,
    duration    INTEGER NOT NULL DEFAULT 2,
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending | delivered | done
    trigger_event_id TEXT,
    created_at  TEXT NOT NULL
  );

  -- Stored, point-in-time snapshots of ONE account's week — generated
  -- automatically every Sunday at 00:00 for every account that has a
  -- device. A user only ever sees their own rows here; there is no
  -- cross-account report anymore.
  CREATE TABLE IF NOT EXISTS weekly_reports (
    id                    TEXT PRIMARY KEY,
    owner                 TEXT NOT NULL,
    device_ip             TEXT,
    period_since          TEXT NOT NULL,
    period_until          TEXT NOT NULL,
    generated_at          TEXT NOT NULL,
    detections_total      INTEGER NOT NULL DEFAULT 0,
    detections_escalated  INTEGER NOT NULL DEFAULT 0,
    deterrence_json       TEXT NOT NULL DEFAULT '{}',
    entries_json          TEXT NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS idx_detections_owner ON detections(owner, timestamp);
  CREATE INDEX IF NOT EXISTS idx_triggers_owner ON trigger_events(owner, created_at);
  CREATE INDEX IF NOT EXISTS idx_commands_owner ON commands(owner, status);
  CREATE INDEX IF NOT EXISTS idx_weekly_owner ON weekly_reports(owner, generated_at);
`);

// ═══════════════════════════════════ ONE-TIME MIGRATION ═══════════════════
// If this DB still has the old shared singleton tables from before accounts
// were isolated, pull their data forward once: the old shared device/settings
// become the FIRST admin account's own device/settings, and old shared
// detections/trigger_events/commands (which had no owner) are attributed to
// that same admin, since that's who the shared Pi used to belong to.
// This runs at most once — it no-ops on any DB that's already migrated.
function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}
function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function migrateFromSharedSchema() {
  if (!tableExists("device")) return; // nothing to migrate

  const firstAdmin =
    db.prepare("SELECT username FROM accounts WHERE role='admin' ORDER BY created_at ASC LIMIT 1").get()?.username ||
    db.prepare("SELECT username FROM accounts ORDER BY created_at ASC LIMIT 1").get()?.username;
  if (!firstAdmin) return; // no accounts yet — nothing meaningful to attribute data to

  const oldDevice = db.prepare("SELECT * FROM device WHERE id = 1").get();
  const oldSettings = tableExists("settings") ? db.prepare("SELECT * FROM settings WHERE id = 1").get() : null;
  const attributeTo = oldDevice?.owner || firstAdmin;

  const alreadyHasDevice = db.prepare("SELECT 1 FROM devices WHERE owner = ?").get(attributeTo);
  if (!alreadyHasDevice && oldDevice) {
    db.prepare(
      `INSERT INTO devices (owner, device_key, ip, online, armed_lights, armed_audio, armed_pepper, armed_last, last_seen)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      attributeTo,
      newDeviceKey(),
      oldDevice.ip,
      0, // force offline until the Pi is reconfigured with its new per-account key
      oldDevice.armed_lights,
      oldDevice.armed_audio,
      oldDevice.armed_pepper,
      oldDevice.armed_last,
      oldDevice.last_seen
    );
    console.log(`[migrate] moved shared device to account "${attributeTo}" — its Pi must be reconfigured with the new device key (Settings → Device)`);
  }
  if (oldSettings) {
    const alreadyHasSettings = db.prepare("SELECT 1 FROM user_settings WHERE owner = ?").get(attributeTo);
    if (!alreadyHasSettings) {
      db.prepare("INSERT INTO user_settings (owner, detecting, detection_interval) VALUES (?,?,?)").run(
        attributeTo, oldSettings.detecting, oldSettings.detection_interval
      );
    }
  }

  if (!columnExists("detections", "owner")) {
    db.exec("ALTER TABLE detections ADD COLUMN owner TEXT");
    db.prepare("UPDATE detections SET owner = ? WHERE owner IS NULL").run(attributeTo);
  }
  if (!columnExists("trigger_events", "owner")) {
    db.exec("ALTER TABLE trigger_events ADD COLUMN owner TEXT");
    db.prepare("UPDATE trigger_events SET owner = ? WHERE owner IS NULL").run(attributeTo);
  }
  if (!columnExists("commands", "owner")) {
    db.exec("ALTER TABLE commands ADD COLUMN owner TEXT");
    db.prepare("UPDATE commands SET owner = ? WHERE owner IS NULL").run(attributeTo);
  }
  if (tableExists("weekly_reports") && !columnExists("weekly_reports", "owner")) {
    db.exec("ALTER TABLE weekly_reports ADD COLUMN owner TEXT");
    db.prepare("UPDATE weekly_reports SET owner = COALESCE(device_owner, ?) WHERE owner IS NULL").run(attributeTo);
  }

  db.exec("DROP TABLE IF EXISTS device");
  db.exec("DROP TABLE IF EXISTS settings");
  console.log(`[migrate] legacy shared tables removed — all prior activity now belongs to "${attributeTo}"`);
}

try { migrateFromSharedSchema(); } catch (e) { console.error("[migrate] failed:", e); }

// ═══════════════════════════════════════ SEEDING ══════════════════════════
// Every account must always have exactly one devices row and one
// user_settings row of its own. Call this whenever a new account is created.
function ensureAccountResources(username) {
  const hasDevice = db.prepare("SELECT 1 FROM devices WHERE owner = ?").get(username);
  if (!hasDevice) {
    db.prepare(
      `INSERT INTO devices (owner, device_key, ip, online, armed_lights, armed_audio, armed_pepper, armed_last, last_seen)
       VALUES (?,?,NULL,0,1,1,1,1,NULL)`
    ).run(username, newDeviceKey());
  }
  const hasSettings = db.prepare("SELECT 1 FROM user_settings WHERE owner = ?").get(username);
  if (!hasSettings) {
    db.prepare("INSERT INTO user_settings (owner, detecting, detection_interval) VALUES (?,1,20)").run(username);
  }
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

// Make sure every existing account (including one just seeded, or ones
// created before this migration) has its own device + settings row.
db.prepare("SELECT username FROM accounts").all().forEach((a) => ensureAccountResources(a.username));

module.exports = db;
module.exports.ensureAccountResources = ensureAccountResources;
module.exports.newDeviceKey = newDeviceKey;
