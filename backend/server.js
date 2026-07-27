require("dotenv").config();
const fs = require("fs");
const path = require("path");
const http = require("http");
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
const TRIGGER_COOLDOWN_MS = (Number(process.env.TRIGGER_COOLDOWN_SECONDS) || 10) * 1000;
const OFFLINE_AFTER_MS = (Number(process.env.DEVICE_OFFLINE_AFTER_SECONDS) || 20) * 1000;
const PHOTOS_DIR = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, "photos") : path.join(__dirname, "photos");

if (!JWT_SECRET) {
  console.error("Missing JWT_SECRET. Copy .env.example to .env and fill it in.");
  process.exit(1);
}
// NOTE: there is no longer a single global DEVICE_KEY. Each account has its
// own device key (db.js generates one automatically per account) — that's
// how the backend tells accounts' Pis apart. See GET /api/device/install-command.
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
// Identifies WHICH account's Pi is calling, by its own per-account device key
// (instead of one shared key for every device). Sets req.deviceOwner.
function requireDevice(req, res, next) {
  const key = req.headers["x-device-key"];
  if (!key) return res.status(401).json({ error: "Missing device key" });
  const d = db.prepare("SELECT * FROM devices WHERE device_key = ?").get(key);
  if (!d) return res.status(401).json({ error: "Invalid device key" });
  req.deviceOwner = d.owner;
  next();
}

// ── WebSocket hub — every socket is tied to the account that opened it, so
// broadcasts only ever reach that one account's own browser tabs. Nothing
// is ever broadcast to "everyone" except the accounts list itself, which
// only admins listen to. ───────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/events" });
function broadcastToOwner(owner, type, payload) {
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.username === owner) client.send(msg);
  });
}
function broadcastToAdmins(type, payload) {
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.role === "admin") client.send(msg);
  });
}
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token");
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    ws.username = payload.username;
    ws.role = payload.role;
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

// mark any account's device offline if its heartbeat has gone silent
setInterval(() => {
  const stale = db
    .prepare("SELECT owner FROM devices WHERE online = 1 AND last_seen IS NOT NULL")
    .all()
    .filter((d) => {
      const row = db.prepare("SELECT last_seen FROM devices WHERE owner = ?").get(d.owner);
      return Date.now() - new Date(row.last_seen).getTime() > OFFLINE_AFTER_MS;
    });
  stale.forEach(({ owner }) => {
    db.prepare("UPDATE devices SET online = 0 WHERE owner = ?").run(owner);
    broadcastToOwner(owner, "status", deviceStatusPayload(owner));
  });
}, 5000);

function deviceStatusPayload(owner) {
  const d = db.prepare("SELECT * FROM devices WHERE owner = ?").get(owner);
  if (!d) return { online: false, ip: null, armed: { lights: true, audio: true, pepper: true, last: true }, last_seen: null };
  return {
    online: !!d.online,
    ip: d.ip,
    armed: {
      lights: !!d.armed_lights,
      audio: !!d.armed_audio,
      pepper: !!d.armed_pepper,
      last: !!d.armed_last,
    },
    last_seen: d.last_seen,
  };
}
function settingsPayload(owner) {
  const s = db.prepare("SELECT * FROM user_settings WHERE owner = ?").get(owner);
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
// Admin can create/deactivate/reassign roles for accounts, but sees NO
// activity data belonging to those accounts — no trigger counts, no last
// activity timestamp, nothing beyond username/role/active/createdAt.
app.get("/api/accounts", requireUser, requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT username, role, active, created_at FROM accounts").all();
  res.json(rows.map((a) => ({ username: a.username, role: a.role, active: !!a.active, createdAt: a.created_at })));
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
    u, hash, r, new Date().toISOString()
  );
  db.ensureAccountResources(u); // gives the new account its own device + settings
  broadcastToAdmins("accounts_changed", {});
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
  broadcastToAdmins("accounts_changed", {});
  res.json({ ok: true });
});

// ══════════════════════════════════════ STATUS / SETTINGS (own device only) ═
app.get("/api/status", requireUser, (req, res) => res.json(deviceStatusPayload(req.user.username)));

app.get("/api/settings", requireUser, (req, res) => res.json(settingsPayload(req.user.username)));

app.post("/api/settings", requireUser, (req, res) => {
  const owner = req.user.username;
  const { detecting, detectionInterval, armed } = req.body || {};
  if (typeof detecting === "boolean") db.prepare("UPDATE user_settings SET detecting = ? WHERE owner = ?").run(detecting ? 1 : 0, owner);
  if (Number.isFinite(detectionInterval)) db.prepare("UPDATE user_settings SET detection_interval = ? WHERE owner = ?").run(detectionInterval, owner);
  if (armed && typeof armed === "object") {
    const d = db.prepare("SELECT * FROM devices WHERE owner = ?").get(owner);
    db.prepare(
      "UPDATE devices SET armed_lights=?, armed_audio=?, armed_pepper=?, armed_last=? WHERE owner = ?"
    ).run(
      armed.lights !== undefined ? (armed.lights ? 1 : 0) : d.armed_lights,
      armed.audio !== undefined ? (armed.audio ? 1 : 0) : d.armed_audio,
      armed.pepper !== undefined ? (armed.pepper ? 1 : 0) : d.armed_pepper,
      armed.last !== undefined ? (armed.last ? 1 : 0) : d.armed_last,
      owner
    );
    broadcastToOwner(owner, "status", deviceStatusPayload(owner));
  }
  broadcastToOwner(owner, "settings", settingsPayload(owner));
  res.json({ settings: settingsPayload(owner), status: deviceStatusPayload(owner) });
});

// ══════════════════════════════════════ DEVICE PAIRING (own device only) ════
// Any account — user or admin — can connect its own Pi. There is no shared
// device to fight over anymore, so there's no "linked to another account" case.
app.post("/api/device/connect", requireUser, (req, res) => {
  const { ip } = req.body || {};
  if (!ip) return res.status(400).json({ error: "IP address required" });
  db.prepare("UPDATE devices SET ip = ? WHERE owner = ?").run(ip, req.user.username);
  broadcastToOwner(req.user.username, "status", deviceStatusPayload(req.user.username));
  res.json(deviceStatusPayload(req.user.username));
});

app.post("/api/device/disconnect", requireUser, (req, res) => {
  db.prepare("UPDATE devices SET ip = NULL, online = 0 WHERE owner = ?").run(req.user.username);
  broadcastToOwner(req.user.username, "status", deviceStatusPayload(req.user.username));
  res.json(deviceStatusPayload(req.user.username));
});

app.get("/api/device/install-command", requireUser, (req, res) => {
  // Each account's own device key — only ever shown to that account, for
  // pasting into their own Pi's installer. No one else's key is ever exposed.
  const d = db.prepare("SELECT device_key FROM devices WHERE owner = ?").get(req.user.username);
  res.json({ command: `curl -sSL https://ratavert.io/install | bash -s -- --device-key ${d.device_key} --backend ${req.protocol}://${req.get("host")}` });
});

// ══════════════════════════════════════ TRIGGERS (dashboard → own Pi) ═══════
const lastFired = new Map(); // `${owner}:${type}` -> timestamp

app.post("/api/trigger", requireUser, (req, res) => {
  const owner = req.user.username;
  const { type, duration } = req.body || {};
  if (!["lights", "audio", "pepper", "last"].includes(type)) return res.status(400).json({ error: "Invalid trigger type" });
  const key = `${owner}:${type}`;
  const last = lastFired.get(key) || 0;
  if (Date.now() - last < TRIGGER_COOLDOWN_MS) {
    return res.status(429).json({ error: `Cooldown active — wait ${Math.ceil((TRIGGER_COOLDOWN_MS - (Date.now() - last)) / 1000)}s before firing "${type}" again` });
  }
  lastFired.set(key, Date.now());

  const eventId = uuid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO trigger_events (id, owner, type, status, source, is_rat, is_last, detail, requested_by, confidence, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(eventId, owner, type, "pending", "manual", 0, type === "last" ? 1 : 0, "Manual test", owner, null, now);

  const cmdId = uuid();
  db.prepare(
    `INSERT INTO commands (id, owner, type, duration, status, trigger_event_id, created_at) VALUES (?,?,?,?,?,?,?)`
  ).run(cmdId, owner, type, Number(duration) || 2, "pending", eventId, now);

  broadcastToOwner(owner, "trigger_requested", { id: eventId, type, status: "pending", user: owner, ts: now });
  res.status(202).json({ id: eventId, status: "pending" });
});

// ══════════════════════════════════════ PI CAMERA TEST (dashboard → own Pi) ═
app.post("/api/pi-camera/test", requireUser, (req, res) => {
  const owner = req.user.username;
  const cmdId = uuid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO commands (id, owner, type, duration, status, trigger_event_id, created_at) VALUES (?,?,?,?,?,?,?)`
  ).run(cmdId, owner, "pi_camera_test", 0, "pending", null, now);
  res.status(202).json({ id: cmdId, status: "pending" });
});

// ══════════════════════════════════════ LOGS / DETECTIONS / PHOTOS (own only) 
app.get("/api/logs", requireUser, (req, res) => {
  const owner = req.user.username;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const since = req.query.since || null;

  const detRows = db
    .prepare(`SELECT * FROM detections WHERE owner = ? ${since ? "AND timestamp > ?" : ""} ORDER BY timestamp DESC LIMIT ?`)
    .all(...(since ? [owner, since, limit] : [owner, limit]));
  const trgRows = db
    .prepare(`SELECT * FROM trigger_events WHERE owner = ? ${since ? "AND created_at > ?" : ""} ORDER BY created_at DESC LIMIT ?`)
    .all(...(since ? [owner, since, limit] : [owner, limit]));

  const merged = [...detRows.map(detectionToLogEntry), ...trgRows.map(triggerToLogEntry)]
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, limit);

  res.json(merged);
});

app.get("/api/detections", requireUser, (req, res) => {
  const owner = req.user.username;
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const since = req.query.since || null;
  const rows = db
    .prepare(`SELECT * FROM detections WHERE owner = ? ${since ? "AND timestamp > ?" : ""} ORDER BY timestamp DESC LIMIT ?`)
    .all(...(since ? [owner, since, limit] : [owner, limit]));
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
  const owner = req.user.username;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const rows = db.prepare("SELECT type, created_at FROM trigger_events WHERE owner = ? AND created_at > ? AND status != 'fail'").all(owner, since);
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

// ══════════════════════════════════════ WEEKLY REPORTS (own account only) ═══
// Every account — user or admin — gets its own stored, point-in-time weekly
// snapshot, generated automatically every Sunday 00:00. No one sees anyone
// else's report; there is no cross-account list anymore.

function generateWeeklyReport(owner) {
  const lastReport = db.prepare("SELECT * FROM weekly_reports WHERE owner = ? ORDER BY period_until DESC LIMIT 1").get(owner);
  const since = lastReport ? lastReport.period_until : new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const until = new Date().toISOString();
  const device = db.prepare("SELECT * FROM devices WHERE owner = ?").get(owner) || {};

  const detectionRows = db
    .prepare("SELECT * FROM detections WHERE owner = ? AND created_at >= ? AND created_at < ? AND source != 'manual'")
    .all(owner, since, until);
  const triggerRows = db
    .prepare("SELECT * FROM trigger_events WHERE owner = ? AND created_at >= ? AND created_at < ?")
    .all(owner, since, until);

  const deterrence = {};
  for (const t of triggerRows) {
    if (!deterrence[t.type]) deterrence[t.type] = { ok: 0, fail: 0 };
    if (t.status === "ok") deterrence[t.type].ok++;
    else if (t.status === "fail") deterrence[t.type].fail++;
  }

  const entries = [
    ...detectionRows.map(detectionToLogEntry),
    ...triggerRows.map(triggerToLogEntry),
  ].sort((a, b) => new Date(b.ts) - new Date(a.ts));

  const id = uuid();
  db.prepare(
    `INSERT INTO weekly_reports (id, owner, device_ip, period_since, period_until, generated_at, detections_total, detections_escalated, deterrence_json, entries_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, owner, device.ip || null, since, until, until,
    detectionRows.length,
    detectionRows.filter((d) => d.escalated).length,
    JSON.stringify(deterrence),
    JSON.stringify(entries)
  );
  console.log(`[weekly-report] generated ${id} for "${owner}" covering ${since} → ${until} (${entries.length} entries)`);
  return db.prepare("SELECT * FROM weekly_reports WHERE id = ?").get(id);
}

function generateAllWeeklyReports() {
  db.prepare("SELECT username FROM accounts").all().forEach(({ username }) => {
    try { generateWeeklyReport(username); } catch (e) { console.error(`[weekly-report] failed for "${username}":`, e); }
  });
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
    generateAllWeeklyReports();
    setInterval(generateAllWeeklyReports, 7 * 24 * 3600 * 1000);
  }, delay);
}
scheduleWeeklyReports();

function weeklyReportSummary(r) {
  return { id: r.id, device_ip: r.device_ip, period_since: r.period_since, period_until: r.period_until, generated_at: r.generated_at };
}

// Level 1 — compact list of MY OWN reports only.
app.get("/api/weekly-reports", requireUser, (req, res) => {
  const rows = db.prepare("SELECT * FROM weekly_reports WHERE owner = ? ORDER BY generated_at DESC").all(req.user.username);
  res.json(rows.map(weeklyReportSummary));
});

// Level 2 — full detail, but only if the report belongs to me.
app.get("/api/weekly-reports/:id", requireUser, (req, res) => {
  const r = db.prepare("SELECT * FROM weekly_reports WHERE id = ?").get(req.params.id);
  if (!r || r.owner !== req.user.username) return res.status(404).json({ error: "Report not found" });
  res.json({
    ...weeklyReportSummary(r),
    detections_total: r.detections_total,
    detections_escalated: r.detections_escalated,
    deterrence: JSON.parse(r.deterrence_json || "{}"),
    entries: JSON.parse(r.entries_json || "[]"),
  });
});

// Manual/testing helper — generates MY OWN report immediately instead of
// waiting for Sunday. Safe to remove once you don't need it for demos.
app.post("/api/weekly-reports/generate", requireUser, (req, res) => {
  const r = generateWeeklyReport(req.user.username);
  res.status(201).json(weeklyReportSummary(r));
});

app.get("/api/photos/:id", requireUser, (req, res) => {
  // Only serve a photo if it belongs to a detection owned by the requester.
  const owner = req.user.username;
  const owns = db.prepare("SELECT 1 FROM detections WHERE owner = ? AND photo_path LIKE ?").get(owner, `%${req.params.id}.jpg`);
  if (!owns) return res.status(404).json({ error: "Photo not found" });
  const file = path.join(PHOTOS_DIR, `${req.params.id}.jpg`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Photo not found" });
  res.sendFile(file);
});

// ══════════════════════════════════════ PI → BACKEND (identified by device key)
app.post("/api/pi/heartbeat", requireDevice, (req, res) => {
  const owner = req.deviceOwner;
  const { online, ip, armed, last_seen } = req.body || {};
  const d = db.prepare("SELECT * FROM devices WHERE owner = ?").get(owner);
  db.prepare(
    `UPDATE devices SET online=?, ip=COALESCE(?,ip), armed_lights=?, armed_audio=?, armed_pepper=?, armed_last=?, last_seen=? WHERE owner = ?`
  ).run(
    online === false ? 0 : 1,
    ip || null,
    armed?.lights !== undefined ? (armed.lights ? 1 : 0) : d.armed_lights,
    armed?.audio !== undefined ? (armed.audio ? 1 : 0) : d.armed_audio,
    armed?.pepper !== undefined ? (armed.pepper ? 1 : 0) : d.armed_pepper,
    armed?.last !== undefined ? (armed.last ? 1 : 0) : d.armed_last,
    last_seen || new Date().toISOString(),
    owner
  );
  broadcastToOwner(owner, "status", deviceStatusPayload(owner));
  res.json({ ok: true });
});

app.post("/api/pi/photos", requireDevice, upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No photo uploaded (field name must be 'photo')" });
  const id = path.basename(req.file.filename, ".jpg");
  res.status(201).json({ photo_id: id, photo_url: `/api/photos/${id}` });
});

app.post("/api/pi/detections", requireDevice, (req, res) => {
  const owner = req.deviceOwner;
  const { timestamp, confidence, photo_url, actions_fired, escalated_to_last_resort } = req.body || {};
  if (!timestamp) return res.status(400).json({ error: "timestamp is required" });
  const id = uuid();
  const now = new Date().toISOString();
  const photoPath = photo_url ? `${path.basename(photo_url)}.jpg` : null;

  db.prepare(
    `INSERT INTO detections (id, owner, timestamp, confidence, photo_path, actions_fired, escalated, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(id, owner, timestamp, confidence ?? null, photoPath, JSON.stringify(actions_fired || []), escalated_to_last_resort ? 1 : 0, now);

  (actions_fired || []).forEach((type) => {
    db.prepare(
      `INSERT INTO trigger_events (id, owner, type, status, source, is_rat, is_last, detail, requested_by, detection_id, confidence, fired_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(uuid(), owner, type, "ok", "auto", 0, type === "last" ? 1 : 0, "Auto-response: rat detected", "auto-detect", id, confidence ?? null, timestamp, now);
  });
  if (escalated_to_last_resort && !(actions_fired || []).includes("last")) {
    db.prepare(
      `INSERT INTO trigger_events (id, owner, type, status, source, is_rat, is_last, detail, requested_by, detection_id, confidence, fired_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(uuid(), owner, "last", "ok", "auto", 0, 1, "Last resort — escalating", "auto-detect", id, confidence ?? null, timestamp, now);
  }

  const detRow = db.prepare("SELECT * FROM detections WHERE id = ?").get(id);
  broadcastToOwner(owner, "detection", detectionToLogEntry(detRow));
  res.status(201).json({ id });
});

app.post("/api/pi/ack", requireDevice, (req, res) => {
  const owner = req.deviceOwner;
  const { type, status, fired_at, command_id, photo_url } = req.body || {};
  let row = command_id ? db.prepare("SELECT * FROM commands WHERE id = ? AND owner = ?").get(command_id, owner) : null;
  if (!row) row = db.prepare("SELECT * FROM commands WHERE owner = ? AND type = ? AND status != 'done' ORDER BY created_at DESC LIMIT 1").get(owner, type);
  if (!row) return res.status(404).json({ error: "No matching pending command" });

  db.prepare("UPDATE commands SET status = 'done' WHERE id = ?").run(row.id);

  if (row.type === "pi_camera_test") {
    broadcastToOwner(owner, "pi_camera_test_result", { command_id: row.id, status: status === "ok" ? "ok" : "fail", photo_url: photo_url || null });
    return res.json({ ok: true });
  }

  if (row.trigger_event_id) {
    db.prepare("UPDATE trigger_events SET status = ?, fired_at = ? WHERE id = ? AND owner = ?").run(
      status === "ok" ? "ok" : "fail",
      fired_at || new Date().toISOString(),
      row.trigger_event_id,
      owner
    );
    const t = db.prepare("SELECT * FROM trigger_events WHERE id = ?").get(row.trigger_event_id);
    broadcastToOwner(owner, "trigger_ack", triggerToLogEntry(t));
  }
  res.json({ ok: true });
});

// Pi polls this instead of running its own server — only ever sees its own
// account's pending commands, never another account's.
app.get("/api/pi/commands", requireDevice, (req, res) => {
  const owner = req.deviceOwner;
  const pending = db.prepare("SELECT * FROM commands WHERE owner = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 10").all(owner);
  const ids = pending.map((c) => c.id);
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`UPDATE commands SET status = 'delivered' WHERE id IN (${placeholders})`).run(...ids);
  }
  res.json(pending.map((c) => ({ id: c.id, type: c.type, duration: c.duration })));
});

// ── health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

server.listen(PORT, () => console.log(`RatAvert backend listening on :${PORT}`));
