const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

// DATA_DIR lets you point the database at a mounted persistent volume in
// production (e.g. Railway's /data volume) so it survives redeploys.
// Defaults to this folder for local development.
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.joirequire("dotenv").config();
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { v4: uuid } = require("uuid");
const { WebSocketServer } = require("ws");
const db = require("./db");

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET;
const DEVICE_KEY = process.env.DEVICE_KEY;
const TRIGGER_COOLDOWN_MS = (Number(process.env.TRIGGER_COOLDOWN_SECONDS) || 10) * 1000;
const OFFLINE_AFTER_MS = (Number(process.env.DEVICE_OFFLINE_AFTER_SECONDS) || 20) * 1000;
const PHOTOS_DIR = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, "photos") : path.join(__dirname, "photos");

if (!JWT_SECRET || !DEVICE_KEY) {
  console.error("Missing JWT_SECRET or DEVICE_KEY. Copy .env.example to .env and fill it in.");
  process.exit(1);
}
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const app = express();
app.set("trust proxy", 1); // required behind Railway/Render's reverse proxy for correct req.protocol/req.ip
app.use(cors({ origin: (process.env.CORS_ORIGIN || "*").split(",") }));
app.use(express.json({ limit: "2mb" }));

const upload = multer({
  storage: multer.diskStorage({
    destination: PHOTOS_DIR,
    filename: (req, file, cb) => cb(null, `${uuid()}.jpg`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

// ── auth middleware ─────────────────────────────────────────────────────────
function requireUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const acc = db.prepare("SELECT * FROM accounts WHERE username = ?").get(payload.username);
    if (!acc || !acc.active) return res.status(401).json({ error: "Account not found or deactivated" });
    req.user = { username: acc.username, role: acc.role };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}
function requireDevice(req, res, next) {
  const key = req.headers["x-device-key"];
  if (!key || key !== DEVICE_KEY) return res.status(401).json({ error: "Invalid device key" });
  next();
}

// ── WebSocket hub ────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/events" });
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token");
  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    ws.close(4001, "unauthorized");
    return;
  }
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
});
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

// mark device offline if heartbeat has gone silent
setInterval(() => {
  const d = db.prepare("SELECT * FROM device WHERE id = 1").get();
  if (d && d.online && d.last_seen) {
    if (Date.now() - new Date(d.last_seen).getTime() > OFFLINE_AFTER_MS) {
      db.prepare("UPDATE device SET online = 0 WHERE id = 1").run();
      broadcast("status", deviceStatusPayload());
    }
  }
}, 5000);

function deviceStatusPayload() {
  const d = db.prepare("SELECT * FROM device WHERE id = 1").get();
  return {
    online: !!d.online,
    ip: d.ip,
    owner: d.owner,
    armed: {
      lights: !!d.armed_lights,
      audio: !!d.armed_audio,
      pepper: !!d.armed_pepper,
      last: !!d.armed_last,
    },
    last_seen: d.last_seen,
  };
}
function settingsPayload() {
  const s = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  return { detecting: !!s.detecting, detectionInterval: s.detection_interval };
}

function fmtT(iso) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtD(iso) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function photoUrlFor(photoPath) {
  if (!photoPath) return null;
  return `/api/photos/${path.basename(photoPath, ".jpg")}`;
}

// Shape a detection row into the "rat detected" log entry the dashboard expects.
// Manual (browser-webcam) test captures share this table but are tagged with
// source='manual' — they never count as a rat detection, just a photo-pipeline test.
function detectionToLogEntry(d) {
  const isManual = d.source === "manual";
  return {
    id: `det-${d.id}`,
    ts: d.timestamp,
    tsStr: fmtT(d.timestamp),
    dateStr: fmtD(d.timestamp),
    type: isManual ? "capture" : null,
    user: isManual ? d.captured_by || "unknown" : "auto-detect",
    status: "ok",
    detail: isManual ? "Manual test capture" : "Motion + heat — rat confirmed",
    isRat: !isManual,
    isLast: false,
    photoId: photoUrlFor(d.photo_path),
    confidence: d.confidence,
  };
}
function triggerToLogEntry(t) {
  return {
    id: `trg-${t.id}`,
    ts: t.fired_at || t.created_at,
    tsStr: fmtT(t.fired_at || t.created_at),
    dateStr: fmtD(t.fired_at || t.created_at),
    type: t.type,
    user: t.requested_by || (t.source === "auto" ? "auto-detect" : "unknown"),
    status: t.status === "ok" ? "ok" : t.status === "fail" ? "fail" : "pending",
    detail: t.detail || (t.source === "auto" ? "Auto-response: rat detected" : "Manual test"),
    isRat: false,
    isLast: !!t.is_last,
    photoId: t.detection_id
      ? photoUrlFor((db.prepare("SELECT photo_path FROM detections WHERE id = ?").get(t.detection_id) || {}).photo_path)
      : null,
    confidence: t.confidence,
  };
}

// ══════════════════════════════════════ AUTH ══════════════════════════════════
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  const acc = db.prepare("SELECT * FROM accounts WHERE username = ?").get(String(username).toLowerCase());
  if (!acc) return res.status(401).json({ error: "Invalid credentials" });
  if (!acc.active) return res.status(403).json({ error: "This account has been deactivated. Contact an administrator." });
  if (!bcrypt.compareSync(password, acc.password_hash)) return res.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ username: acc.username, role: acc.role }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, user: { username: acc.username, role: acc.role } });
});

app.get("/api/me", requireUser, (req, res) => res.json({ user: req.user }));

app.post("/api/auth/change-password", requireUser, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Current and new password are required" });
  if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
  const acc = db.prepare("SELECT * FROM accounts WHERE username = ?").get(req.user.username);
  if (!bcrypt.compareSync(currentPassword, acc.password_hash)) return res.status(401).json({ error: "Current password is incorrect" });
  db.prepare("UPDATE accounts SET password_hash = ? WHERE username = ?").run(bcrypt.hashSync(newPassword, 10), req.user.username);
  res.json({ ok: true });
});

app.post("/api/me/password", requireUser, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Current and new password are required" });
  if (String(newPassword).length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
  const acc = db.prepare("SELECT * FROM accounts WHERE username = ?").get(req.user.username);
  if (!bcrypt.compareSync(currentPassword, acc.password_hash)) return res.status(401).json({ error: "Current password is incorrect" });
  db.prepare("UPDATE accounts SET password_hash = ? WHERE username = ?").run(bcrypt.hashSync(newPassword, 10), req.user.username);
  res.json({ ok: true });
});

// ══════════════════════════════════════ ACCOUNTS (admin) ═════════════════════
app.get("/api/accounts", requireUser, requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT username, role, active, created_at FROM accounts").all();
  const withStats = rows.map((a) => {
    const fired = db
      .prepare("SELECT COUNT(*) AS c FROM trigger_events WHERE requested_by = ? AND source = 'manual'")
      .get(a.username).c;
    const last = db
      .prepare("SELECT created_at FROM trigger_events WHERE requested_by = ? ORDER BY created_at DESC LIMIT 1")
      .get(a.username);
    return {
      username: a.username,
      role: a.role,
      active: !!a.active,
      createdAt: a.created_at,
      triggersFired: fired,
      lastActivity: last ? last.created_at : null,
    };
  });
  res.json(withStats);
});

app.post("/api/accounts", requireUser, requireAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  const u = String(username).toLowerCase().trim();
  const r = role === "admin" ? "admin" : "user";
  const existing = db.prepare("SELECT username FROM accounts WHERE username = ?").get(u);
  if (existing) return res.status(409).json({ error: "That username already exists" });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("INSERT INTO accounts (username, password_hash, role, active, created_at) VALUES (?,?,?,1,?)").run(
    u,
    hash,
    r,
    new Date().toISOString()
  );
  broadcast("accounts_changed", {});
  res.status(201).json({ username: u, role: r, active: true });
});

app.patch("/api/accounts/:username", requireUser, requireAdmin, (req, res) => {
  const u = req.params.username.toLowerCase();
  const acc = db.prepare("SELECT * FROM accounts WHERE username = ?").get(u);
  if (!acc) return res.status(404).json({ error: "Account not found" });
  if (u === req.user.username) return res.status(400).json({ error: "You can't change your own role or status" });
  const { role, active, password } = req.body || {};
  if (role) db.prepare("UPDATE accounts SET role = ? WHERE username = ?").run(role === "admin" ? "admin" : "user", u);
  if (typeof active === "boolean") db.prepare("UPDATE accounts SET active = ? WHERE username = ?").run(active ? 1 : 0, u);
  if (password) db.prepare("UPDATE accounts SET password_hash = ? WHERE username = ?").run(bcrypt.hashSync(password, 10), u);
  broadcast("accounts_changed", {});
  res.json({ ok: true });
});

// ══════════════════════════════════════ STATUS / SETTINGS ═══════════════════
app.get("/api/status", requireUser, (req, res) => res.json(deviceStatusPayload()));

app.get("/api/settings", requireUser, (req, res) => res.json(settingsPayload()));

app.post("/api/settings", requireUser, (req, res) => {
  const { detecting, detectionInterval, armed } = req.body || {};
  if (typeof detecting === "boolean") db.prepare("UPDATE settings SET detecting = ? WHERE id = 1").run(detecting ? 1 : 0);
  if (Number.isFinite(detectionInterval)) db.prepare("UPDATE settings SET detection_interval = ? WHERE id = 1").run(detectionInterval);
  if (armed && typeof armed === "object") {
    const d = db.prepare("SELECT * FROM device WHERE id = 1").get();
    db.prepare(
      "UPDATE device SET armed_lights=?, armed_audio=?, armed_pepper=?, armed_last=? WHERE id = 1"
    ).run(
      armed.lights !== undefined ? (armed.lights ? 1 : 0) : d.armed_lights,
      armed.audio !== undefined ? (armed.audio ? 1 : 0) : d.armed_audio,
      armed.pepper !== undefined ? (armed.pepper ? 1 : 0) : d.armed_pepper,
      armed.last !== undefined ? (armed.last ? 1 : 0) : d.armed_last
    );
    broadcast("status", deviceStatusPayload());
  }
  broadcast("settings", settingsPayload());
  res.json({ settings: settingsPayload(), status: deviceStatusPayload() });
});

// ══════════════════════════════════════ DEVICE PAIRING ═══════════════════════
app.post("/api/device/connect", requireUser, requireAdmin, (req, res) => {
  const { ip } = req.body || {};
  if (!ip) return res.status(400).json({ error: "IP address required" });
  const d = db.prepare("SELECT * FROM device WHERE id = 1").get();
  if (d.owner && d.owner !== req.user.username) {
    return res.status(409).json({ error: `Device is linked to "${d.owner}". Ask them to disconnect it first.` });
  }
  db.prepare("UPDATE device SET ip = ?, owner = ? WHERE id = 1").run(ip, req.user.username);
  broadcast("status", deviceStatusPayload());
  res.json(deviceStatusPayload());
});

app.post("/api/device/disconnect", requireUser, requireAdmin, (req, res) => {
  const d = db.prepare("SELECT * FROM device WHERE id = 1").get();
  if (d.owner && d.owner !== req.user.username) return res.status(403).json({ error: "Only the linking admin can disconnect this device" });
  db.prepare("UPDATE device SET ip = NULL, owner = NULL, online = 0 WHERE id = 1").run();
  broadcast("status", deviceStatusPayload());
  res.json(deviceStatusPayload());
});

app.get("/api/device/install-command", requireUser, requireAdmin, (req, res) => {
  // The device key is only ever shown to admins, once, for pasting into the Pi installer.
  res.json({ command: `curl -sSL https://ratavert.io/install | bash -s -- --device-key ${DEVICE_KEY} --backend ${req.protocol}://${req.get("host")}` });
});

// ══════════════════════════════════════ TRIGGERS (dashboard → Pi) ════════════
const lastFired = new Map(); // `${user}:${type}` -> timestamp

app.post("/api/trigger", requireUser, (req, res) => {
  const { type, duration } = req.body || {};
  if (!["lights", "audio", "pepper", "last"].includes(type)) return res.status(400).json({ error: "Invalid trigger type" });
  const key = `${req.user.username}:${type}`;
  const last = lastFired.get(key) || 0;
  if (Date.now() - last < TRIGGER_COOLDOWN_MS) {
    return res.status(429).json({ error: `Cooldown active — wait ${Math.ceil((TRIGGER_COOLDOWN_MS - (Date.now() - last)) / 1000)}s before firing "${type}" again` });
  }
  lastFired.set(key, Date.now());

  const eventId = uuid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO trigger_events (id, type, status, source, is_rat, is_last, detail, requested_by, confidence, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(eventId, type, "pending", "manual", 0, type === "last" ? 1 : 0, "Manual test", req.user.username, null, now);

  const cmdId = uuid();
  db.prepare(
    `INSERT INTO commands (id, type, duration, status, trigger_event_id, created_at) VALUES (?,?,?,?,?,?)`
  ).run(cmdId, type, Number(duration) || 2, "pending", eventId, now);

  broadcast("trigger_requested", { id: eventId, type, status: "pending", user: req.user.username, ts: now });
  res.status(202).json({ id: eventId, status: "pending" });
});

// ══════════════════════════════════════ PI CAMERA TEST (dashboard → Pi) ═════
// Separate from /api/trigger on purpose: this doesn't actuate any hardware,
// isn't subject to the deterrence cooldown, and doesn't create a trigger_event
// row (there's nothing to arm/disarm or log as a deterrence action). It reuses
// the same commands/ack polling plumbing the Pi already has for triggers.
app.post("/api/pi-camera/test", requireUser, (req, res) => {
  const cmdId = uuid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO commands (id, type, duration, status, trigger_event_id, created_at) VALUES (?,?,?,?,?,?)`
  ).run(cmdId, "pi_camera_test", 0, "pending", null, now);
  res.status(202).json({ id: cmdId, status: "pending" });
});

// ══════════════════════════════════════ LOGS / DETECTIONS / PHOTOS ═══════════
app.get("/api/logs", requireUser, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const since = req.query.since || null;

  const detRows = db
    .prepare(`SELECT * FROM detections ${since ? "WHERE timestamp > ?" : ""} ORDER BY timestamp DESC LIMIT ?`)
    .all(...(since ? [since, limit] : [limit]));
  const trgRows = db
    .prepare(`SELECT * FROM trigger_events ${since ? "WHERE created_at > ?" : ""} ORDER BY created_at DESC LIMIT ?`)
    .all(...(since ? [since, limit] : [limit]));

  const merged = [...detRows.map(detectionToLogEntry), ...trgRows.map(triggerToLogEntry)]
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, limit);

  res.json(merged);
});

app.get("/api/detections", requireUser, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const since = req.query.since || null;
  const rows = db
    .prepare(`SELECT * FROM detections ${since ? "WHERE timestamp > ?" : ""} ORDER BY timestamp DESC LIMIT ?`)
    .all(...(since ? [since, limit] : [limit]));
  res.json(
    rows.map((d) => {
      const isManual = d.source === "manual";
      return {
        id: d.id,
        ts: d.timestamp,
        tsStr: fmtT(d.timestamp),
        dateStr: fmtD(d.timestamp),
        confidence: d.confidence,
        url: photoUrlFor(d.photo_path),
        actionsFired: JSON.parse(d.actions_fired || "[]"),
        escalated: !!d.escalated,
        type: isManual ? "capture" : d.escalated ? "last" : "pepper",
        isRat: !isManual,
        capturedBy: isManual ? d.captured_by : null,
      };
    })
  );
});

app.get("/api/analytics/hourly", requireUser, (req, res) => {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const rows = db.prepare("SELECT type, created_at FROM trigger_events WHERE created_at > ? AND status != 'fail'").all(since);
  const buckets = Array.from({ length: 24 }, (_, i) => {
    const h = new Date();
    h.setMinutes(0, 0, 0);
    h.setHours(h.getHours() - (23 - i));
    return { label: `${String(h.getHours()).padStart(2, "0")}:00`, lights: 0, audio: 0, pepper: 0, last: 0, _h: h };
  });
  rows.forEach((r) => {
    const t = new Date(r.created_at);
    const b = buckets.find((b) => b._h.getHours() === t.getHours() && b._h.getDate() === t.getDate());
    if (b && b[r.type] !== undefined) b[r.type]++;
  });
  res.json(buckets.map(({ _h, ...b }) => b));
});

// ══════════════════════════════════════ WEEKLY REPORTS (admin) ══════════════
// A report is a STORED SNAPSHOT, not a live query — generated automatically
// every Sunday at 00:00, covering the 7 days since the last report (or the
// last 7 days, on the very first run). This models "the user's IoT device
// sends its week's activity to the admin," distinct from that same user's
// own always-live Activity page.

function generateWeeklyReport() {
  const lastReport = db.prepare("SELECT * FROM weekly_reports ORDER BY period_until DESC LIMIT 1").get();
  const since = lastReport ? lastReport.period_until : new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const until = new Date().toISOString();
  const device = db.prepare("SELECT * FROM device WHERE id = 1").get() || {};

  const detectionRows = db
    .prepare("SELECT * FROM detections WHERE created_at >= ? AND created_at < ? AND source != 'manual'")
    .all(since, until);
  const triggerRows = db
    .prepare("SELECT * FROM trigger_events WHERE created_at >= ? AND created_at < ?")
    .all(since, until);

  const deterrence = {};
  for (const t of triggerRows) {
    if (!deterrence[t.type]) deterrence[t.type] = { ok: 0, fail: 0 };
    if (t.status === "ok") deterrence[t.type].ok++;
    else if (t.status === "fail") deterrence[t.type].fail++;
  }

  // Same shape the live Activity table already uses — so the report's detail
  // view can reuse that exact rendering logic on the frontend.
  const entries = [
    ...detectionRows.map(detectionToLogEntry),
    ...triggerRows.map(triggerToLogEntry),
  ].sort((a, b) => new Date(b.ts) - new Date(a.ts));

  const id = uuid();
  db.prepare(
    `INSERT INTO weekly_reports (id, device_owner, device_ip, period_since, period_until, generated_at, detections_total, detections_escalated, deterrence_json, entries_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    device.owner || null,
    device.ip || null,
    since,
    until,
    until,
    detectionRows.length,
    detectionRows.filter((d) => d.escalated).length,
    JSON.stringify(deterrence),
    JSON.stringify(entries)
  );
  console.log(`[weekly-report] generated ${id} covering ${since} → ${until} (${entries.length} entries)`);
  return db.prepare("SELECT * FROM weekly_reports WHERE id = ?").get(id);
}

function msUntilNextSundayMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24 * ((7 - now.getDay()) % 7 || 7), 0, 0, 0); // rolls to next Sunday 00:00
  if (next <= now) next.setDate(next.getDate() + 7);
  return next.getTime() - now.getTime();
}

function scheduleWeeklyReports() {
  const delay = msUntilNextSundayMidnight();
  console.log(`[weekly-report] next auto-generation in ${Math.round(delay / 3600000)}h`);
  setTimeout(() => {
    try { generateWeeklyReport(); } catch (e) { console.error("[weekly-report] generation failed:", e); }
    setInterval(() => {
      try { generateWeeklyReport(); } catch (e) { console.error("[weekly-report] generation failed:", e); }
    }, 7 * 24 * 3600 * 1000);
  }, delay);
}
scheduleWeeklyReports();

function weeklyReportSummary(r) {
  return {
    id: r.id,
    device_owner: r.device_owner,
    device_ip: r.device_ip,
    period_since: r.period_since,
    period_until: r.period_until,
    generated_at: r.generated_at,
  };
}

// Level 1 — compact list: account, device, timestamp, nothing else.
app.get("/api/admin/weekly-reports", requireUser, requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM weekly_reports ORDER BY generated_at DESC").all();
  res.json(rows.map(weeklyReportSummary));
});

// Level 2 — full detail: same entry shape as the user's own Activity table,
// including status and confidence, per what was asked for.
app.get("/api/admin/weekly-reports/:id", requireUser, requireAdmin, (req, res) => {
  const r = db.prepare("SELECT * FROM weekly_reports WHERE id = ?").get(req.params.id);
  if (!r) return res.status(404).json({ error: "Report not found" });
  res.json({
    ...weeklyReportSummary(r),
    detections_total: r.detections_total,
    detections_escalated: r.detections_escalated,
    deterrence: JSON.parse(r.deterrence_json || "{}"),
    entries: JSON.parse(r.entries_json || "[]"),
  });
});

// Manual/testing helper — generates one immediately instead of waiting for
// Sunday. Handy for demoing the feature; safe to remove once you don't need it.
app.post("/api/admin/weekly-reports/generate", requireUser, requireAdmin, (req, res) => {
  const r = generateWeeklyReport();
  res.status(201).json(weeklyReportSummary(r));
});

app.get("/api/photos/:id", (req, res) => {
  const file = path.join(PHOTOS_DIR, `${req.params.id}.jpg`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Photo not found" });
  res.sendFile(file);
});

// ══════════════════════════════════════ PI → BACKEND ══════════════════════════
app.post("/api/pi/heartbeat", requireDevice, (req, res) => {
  const { online, ip, armed, last_seen } = req.body || {};
  const d = db.prepare("SELECT * FROM device WHERE id = 1").get();
  db.prepare(
    `UPDATE device SET online=?, ip=COALESCE(?,ip), armed_lights=?, armed_audio=?, armed_pepper=?, armed_last=?, last_seen=? WHERE id = 1`
  ).run(
    online === false ? 0 : 1,
    ip || null,
    armed?.lights !== undefined ? (armed.lights ? 1 : 0) : d.armed_lights,
    armed?.audio !== undefined ? (armed.audio ? 1 : 0) : d.armed_audio,
    armed?.pepper !== undefined ? (armed.pepper ? 1 : 0) : d.armed_pepper,
    armed?.last !== undefined ? (armed.last ? 1 : 0) : d.armed_last,
    last_seen || new Date().toISOString()
  );
  broadcast("status", deviceStatusPayload());
  res.json({ ok: true });
});

app.post("/api/pi/photos", requireDevice, upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No photo uploaded (field name must be 'photo')" });
  const id = path.basename(req.file.filename, ".jpg");
  res.status(201).json({ photo_id: id, photo_url: `/api/photos/${id}` });
});

app.post("/api/pi/detections", requireDevice, (req, res) => {
  const { timestamp, confidence, photo_url, actions_fired, escalated_to_last_resort } = req.body || {};
  if (!timestamp) return res.status(400).json({ error: "timestamp is required" });
  const id = uuid();
  const now = new Date().toISOString();
  const photoPath = photo_url ? `${path.basename(photo_url)}.jpg` : null;

  db.prepare(
    `INSERT INTO detections (id, timestamp, confidence, photo_path, actions_fired, escalated, created_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(id, timestamp, confidence ?? null, photoPath, JSON.stringify(actions_fired || []), escalated_to_last_resort ? 1 : 0, now);

  (actions_fired || []).forEach((type) => {
    db.prepare(
      `INSERT INTO trigger_events (id, type, status, source, is_rat, is_last, detail, requested_by, detection_id, confidence, fired_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(uuid(), type, "ok", "auto", 0, type === "last" ? 1 : 0, "Auto-response: rat detected", "auto-detect", id, confidence ?? null, timestamp, now);
  });
  if (escalated_to_last_resort && !(actions_fired || []).includes("last")) {
    db.prepare(
      `INSERT INTO trigger_events (id, type, status, source, is_rat, is_last, detail, requested_by, detection_id, confidence, fired_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(uuid(), "last", "ok", "auto", 0, 1, "Last resort — escalating", "auto-detect", id, confidence ?? null, timestamp, now);
  }

  const detRow = db.prepare("SELECT * FROM detections WHERE id = ?").get(id);
  broadcast("detection", detectionToLogEntry(detRow));
  res.status(201).json({ id });
});

app.post("/api/pi/ack", requireDevice, (req, res) => {
  const { type, status, fired_at, command_id, photo_url } = req.body || {};
  let row = command_id ? db.prepare("SELECT * FROM commands WHERE id = ?").get(command_id) : null;
  if (!row) row = db.prepare("SELECT * FROM commands WHERE type = ? AND status != 'done' ORDER BY created_at DESC LIMIT 1").get(type);
  if (!row) return res.status(404).json({ error: "No matching pending command" });

  db.prepare("UPDATE commands SET status = 'done' WHERE id = ?").run(row.id);

  if (row.type === "pi_camera_test") {
    // No trigger_event exists for this command type — broadcast the photo
    // straight to whoever's watching instead of touching trigger_events.
    broadcast("pi_camera_test_result", { command_id: row.id, status: status === "ok" ? "ok" : "fail", photo_url: photo_url || null });
    return res.json({ ok: true });
  }

  if (row.trigger_event_id) {
    db.prepare("UPDATE trigger_events SET status = ?, fired_at = ? WHERE id = ?").run(
      status === "ok" ? "ok" : "fail",
      fired_at || new Date().toISOString(),
      row.trigger_event_id
    );
    const t = db.prepare("SELECT * FROM trigger_events WHERE id = ?").get(row.trigger_event_id);
    broadcast("trigger_ack", triggerToLogEntry(t));
  }
  res.json({ ok: true });
});

// Pi polls this instead of running its own server — works from behind NAT/firewalls
app.get("/api/pi/commands", requireDevice, (req, res) => {
  const pending = db.prepare("SELECT * FROM commands WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10").all();
  const ids = pending.map((c) => c.id);
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`UPDATE commands SET status = 'delivered' WHERE id IN (${placeholders})`).run(...ids);
  }
  res.json(pending.map((c) => ({ id: c.id, type: c.type, duration: c.duration })));
});

// ── health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

server.listen(PORT, () => console.log(`RatAvert backend listening on :${PORT}`));n(DATA_DIR, "ratavert.db"));
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
