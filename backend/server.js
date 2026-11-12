require("dotenv").config();

const REQUIRED_ENV = ["JWT_SECRET", "DEVICE_KEY", "DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error(`Missing environment variables: ${missingEnv.join(", ")}. Copy .env.example to .env and fill it in.`);
  process.exit(1);
}

const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const uuid = () => require("crypto").randomUUID();
const { WebSocketServer } = require("ws");
const { createClient } = require("@supabase/supabase-js");
const db = require("./db");

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET;
const DEVICE_KEY = process.env.DEVICE_KEY;
const TRIGGER_COOLDOWN_MS = (Number(process.env.TRIGGER_COOLDOWN_SECONDS) || 10) * 1000;
const OFFLINE_AFTER_MS = (Number(process.env.DEVICE_OFFLINE_AFTER_SECONDS) || 20) * 1000;
const PHOTO_BUCKET = process.env.SUPABASE_BUCKET || "photos";

process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", reason));

// Photos live in a private Supabase Storage bucket. Only this server (using the
// secret key) can read or write it.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const photoBucket = () => supabase.storage.from(PHOTO_BUCKET);

// ── small helpers ───────────────────────────────────────────────────────────
// Any date-like value -> millisecond-precision ISO string, or null if it is not a real date.
function toIso(value) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function parseLimit(value, fallback, max) {
  const n = Math.floor(Number(value));
  return Math.min(Number.isFinite(n) && n > 0 ? n : fallback, max);
}
// Express 4 does not catch errors from async handlers, so every async route goes through this.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.set("trust proxy", 1); // required behind Render's reverse proxy for correct req.protocol/req.ip
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);
app.use(cors({ origin: corsOrigins.length === 0 || corsOrigins.includes("*") ? true : corsOrigins }));
app.use(express.json({ limit: "2mb" }));

// Photos are held in memory just long enough to hand them to Supabase Storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

// ── auth middleware ─────────────────────────────────────────────────────────
const requireUser = wrap(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  const acc = await db.one("SELECT username, role, active FROM accounts WHERE username = $1", [payload.username]);
  if (!acc || !acc.active) return res.status(401).json({ error: "Account not found or deactivated" });
  req.user = { username: acc.username, role: acc.role };
  next();
});
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}
// Each Pi identifies itself with X-Device-Id (defaults to device 1, so the
// existing Pi keeps working unchanged) and X-Device-Key (the shared key, or the
// device's own device_key).
const requireDevice = wrap(async (req, res, next) => {
  const key = req.headers["x-device-key"];
  const id = parseInt(req.headers["x-device-id"], 10) || 1;
  const d = await db.one("SELECT id, device_key FROM device WHERE id = $1", [id]);
  if (!d) return res.status(401).json({ error: "Unknown device" });
  if (!key || (key !== DEVICE_KEY && key !== d.device_key)) return res.status(401).json({ error: "Invalid device key" });
  req.deviceId = d.id;
  next();
});

// Which device a logged-in user may see. Admin: a chosen device, or null = all.
// User: only the device whose owner is their username (0 = none, sees nothing).
async function userDeviceId(user, requested) {
  if (user.role === "admin") return Number(requested) || null;
  const d = await db.one("SELECT id FROM device WHERE owner = $1 ORDER BY id LIMIT 1", [user.username]);
  return d ? d.id : 0;
}

// ── WebSocket hub ────────────────────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/events" });
// deviceId (optional) limits the event to admins and to that device's owner.
function broadcast(type, payload, deviceId) {
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState !== 1) return;
    if (deviceId != null && client.role !== "admin" && client.deviceId !== deviceId) return;
    client.send(msg);
  });
}
wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token");
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    ws.close(4001, "unauthorized");
    return;
  }
  ws.role = payload.role;
  try {
    ws.deviceId = await userDeviceId({ username: payload.username, role: payload.role });
  } catch {
    ws.deviceId = 0;
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

async function deviceStatusPayload(deviceId = 1) {
  const d = (await db.one("SELECT * FROM device WHERE id = $1", [deviceId])) || {};
  return {
    deviceId: d.id,
    name: d.name || null,
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
async function settingsPayload(deviceId = 1) {
  const s = (await db.one("SELECT * FROM settings WHERE id = 1")) || {};
  const d = (await db.one("SELECT detecting FROM device WHERE id = $1", [deviceId])) || {};
  return { detecting: d.detecting == null ? !!s.detecting : !!d.detecting, detectionInterval: s.detection_interval };
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
    detail: isManual ? "Manual test capture" : "Rat confirmed",
    isRat: !isManual,
    isLast: false,
    photoId: photoUrlFor(d.photo_path),
    confidence: d.confidence,
  };
}
// Trigger rows are always read with this query so each one carries the photo
// of the detection that caused it (det_photo_path) without a second lookup.
const TRIGGER_SELECT = `SELECT t.*, d.photo_path AS det_photo_path
  FROM trigger_events t LEFT JOIN detections d ON d.id = t.detection_id`;

function triggerToLogEntry(t) {
  const when = t.fired_at || t.created_at;
  return {
    id: `trg-${t.id}`,
    ts: when,
    tsStr: fmtT(when),
    dateStr: fmtD(when),
    type: t.type,
    user: t.requested_by || (t.source === "auto" ? "auto-detect" : "unknown"),
    status: t.status === "ok" ? "ok" : t.status === "fail" ? "fail" : "pending",
    detail: t.detail || (t.source === "auto" ? "Auto-response: rat detected" : "Manual test"),
    isRat: false,
    isLast: !!t.is_last,
    photoId: photoUrlFor(t.det_photo_path),
    confidence: t.confidence,
  };
}

// Builds and stores one point-in-time weekly snapshot into the weekly_reports
// table, covering the 7 days up to "now". This is what backs the admin's
// Device Reports (Weekly tab) — a frozen record, not a live query, so past
// weeks stay stable even as new detections/triggers keep coming in.
async function generateWeeklyReport(deviceId = 1) {
  const now = new Date();
  const sinceIso = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  const nowIso = now.toISOString();

  const device = (await db.one("SELECT * FROM device WHERE id = $1", [deviceId])) || {};
  const detRows = await db.many(
    `SELECT * FROM detections WHERE "timestamp" >= $1 AND source != 'manual' AND device_id = $2 ORDER BY "timestamp" DESC`,
    [sinceIso, deviceId]
  );
  const trgRows = await db.many(`${TRIGGER_SELECT} WHERE t.created_at >= $1 AND t.device_id = $2 ORDER BY t.created_at DESC`, [sinceIso, deviceId]);

  const entries = [...detRows.map(detectionToLogEntry), ...trgRows.map(triggerToLogEntry)].sort(
    (a, b) => new Date(b.ts) - new Date(a.ts)
  );

  const detections_total = detRows.length;
  const detections_escalated = detRows.filter((d) => d.escalated).length;

  const deterrence = {};
  trgRows.forEach((t) => {
    if (!deterrence[t.type]) deterrence[t.type] = { ok: 0, fail: 0 };
    if (t.status === "ok") deterrence[t.type].ok += 1;
    else if (t.status === "fail") deterrence[t.type].fail += 1;
  });

  const id = uuid();
  await db.query(
    `INSERT INTO weekly_reports
       (id, device_owner, device_ip, period_since, period_until, generated_at,
        detections_total, detections_escalated, deterrence_json, entries_json, device_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
    [
      id,
      device.owner || null,
      device.ip || null,
      sinceIso,
      nowIso,
      nowIso,
      detections_total,
      detections_escalated,
      JSON.stringify(deterrence),
      JSON.stringify(entries),
      deviceId,
    ]
  );
  return id;
}

// ══════════════════════════════════════ AUTH ══════════════════════════════════
app.post(
  "/api/auth/login",
  wrap(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });
    const acc = await db.one("SELECT * FROM accounts WHERE username = $1", [String(username).toLowerCase()]);
    if (!acc) return res.status(401).json({ error: "Invalid credentials" });
    if (!acc.active) return res.status(403).json({ error: "This account has been deactivated. Contact an administrator." });
    if (!(await bcrypt.compare(String(password), acc.password_hash))) return res.status(401).json({ error: "Invalid credentials" });
    const token = jwt.sign({ username: acc.username, role: acc.role }, JWT_SECRET, { expiresIn: "12h" });
    res.json({ token, user: { username: acc.username, role: acc.role } });
  })
);

app.get("/api/me", requireUser, (req, res) => res.json({ user: req.user }));

const changePassword = wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Current and new password are required" });
  if (String(newPassword).length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
  const acc = await db.one("SELECT password_hash FROM accounts WHERE username = $1", [req.user.username]);
  if (!acc || !(await bcrypt.compare(String(currentPassword), acc.password_hash))) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  const hash = await bcrypt.hash(String(newPassword), 10);
  await db.query("UPDATE accounts SET password_hash = $1 WHERE username = $2", [hash, req.user.username]);
  res.json({ ok: true });
});
// The dashboard may call either path; both do the same thing.
app.post("/api/auth/change-password", requireUser, changePassword);
app.post("/api/me/password", requireUser, changePassword);

// ══════════════════════════════════════ ACCOUNTS (admin) ═════════════════════
app.get(
  "/api/accounts",
  requireUser,
  requireAdmin,
  wrap(async (req, res) => {
    const rows = await db.many(
      `SELECT a.username, a.role, a.active, a.created_at,
              (SELECT COUNT(*)::int FROM trigger_events t
                WHERE t.requested_by = a.username AND t.source = 'manual') AS triggers_fired,
              (SELECT MAX(t.created_at) FROM trigger_events t
                WHERE t.requested_by = a.username) AS last_activity
         FROM accounts a
        ORDER BY a.created_at ASC, a.username ASC`
    );
    res.json(
      rows.map((a) => ({
        username: a.username,
        role: a.role,
        active: !!a.active,
        createdAt: a.created_at,
        triggersFired: a.triggers_fired,
        lastActivity: a.last_activity || null,
      }))
    );
  })
);

app.post(
  "/api/accounts",
  requireUser,
  requireAdmin,
  wrap(async (req, res) => {
    const { username, password, role } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });
    const u = String(username).toLowerCase().trim();
    if (!u) return res.status(400).json({ error: "Username and password required" });
    const r = role === "admin" ? "admin" : "user";
    const hash = await bcrypt.hash(String(password), 10);
    const inserted = await db.one(
      `INSERT INTO accounts (username, password_hash, role, active, created_at)
       VALUES ($1,$2,$3,true,$4) ON CONFLICT (username) DO NOTHING RETURNING username`,
      [u, hash, r, new Date().toISOString()]
    );
    if (!inserted) return res.status(409).json({ error: "That username already exists" });
    broadcast("accounts_changed", {});
    res.status(201).json({ username: u, role: r, active: true });
  })
);

app.patch(
  "/api/accounts/:username",
  requireUser,
  requireAdmin,
  wrap(async (req, res) => {
    const u = req.params.username.toLowerCase();
    const acc = await db.one("SELECT username FROM accounts WHERE username = $1", [u]);
    if (!acc) return res.status(404).json({ error: "Account not found" });
    if (u === req.user.username) return res.status(400).json({ error: "You can't change your own role or status" });
    const { role, active, password } = req.body || {};
    const sets = [];
    const vals = [];
    if (role) {
      vals.push(role === "admin" ? "admin" : "user");
      sets.push(`role = $${vals.length}`);
    }
    if (typeof active === "boolean") {
      vals.push(active);
      sets.push(`active = $${vals.length}`);
    }
    if (password) {
      vals.push(await bcrypt.hash(String(password), 10));
      sets.push(`password_hash = $${vals.length}`);
    }
    if (sets.length) {
      vals.push(u);
      await db.query(`UPDATE accounts SET ${sets.join(", ")} WHERE username = $${vals.length}`, vals);
    }
    broadcast("accounts_changed", {});
    res.json({ ok: true });
  })
);

// Admin deletes an account. Requires the admin's own password as confirmation.
// The account's device (if any) is unassigned; detection history is kept.
app.delete(
  "/api/accounts/:username",
  requireUser,
  requireAdmin,
  wrap(async (req, res) => {
    const u = req.params.username.toLowerCase();
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: "Your admin password is required" });
    const me = await db.one("SELECT password_hash FROM accounts WHERE username = $1", [req.user.username]);
    if (!me || !(await bcrypt.compare(String(password), me.password_hash))) {
      return res.status(401).json({ error: "Admin password is incorrect" });
    }
    if (u === req.user.username) return res.status(400).json({ error: "You can't delete your own account" });
    const acc = await db.one("SELECT username FROM accounts WHERE username = $1", [u]);
    if (!acc) return res.status(404).json({ error: "Account not found" });
    await db.tx(async (client) => {
      await client.query("UPDATE device SET owner = NULL WHERE owner = $1", [u]);
      await client.query("DELETE FROM accounts WHERE username = $1", [u]);
    });
    broadcast("accounts_changed", {});
    res.json({ ok: true });
  })
);

// ══════════════════════════════════════ STATUS / SETTINGS ═══════════════════
app.get(
  "/api/status",
  requireUser,
  wrap(async (req, res) => res.json(await deviceStatusPayload((await userDeviceId(req.user, req.query.device)) || 1)))
);

app.get(
  "/api/settings",
  requireUser,
  wrap(async (req, res) => res.json(await settingsPayload((await userDeviceId(req.user, req.query.device)) || 1)))
);

app.post(
  "/api/settings",
  requireUser,
  wrap(async (req, res) => {
        const { detecting, detectionInterval, armed } = req.body || {};
    const devId = (await userDeviceId(req.user, req.body && req.body.device)) || (req.user.role === "admin" ? 1 : 0);
    if (!devId) return res.status(403).json({ error: "No device is assigned to your account" });
    if (typeof detecting === "boolean") await db.query("UPDATE device SET detecting = $1 WHERE id = $2", [detecting, devId]);
    if (Number.isFinite(detectionInterval)) {
      await db.query("UPDATE settings SET detection_interval = $1 WHERE id = 1", [Math.round(detectionInterval)]);
    }
    if (armed && typeof armed === "object") {
      const flag = (v) => (v === undefined ? null : !!v);
      await db.query(
        `UPDATE device SET
           armed_lights = COALESCE($1::boolean, armed_lights),
           armed_audio  = COALESCE($2::boolean, armed_audio),
           armed_pepper = COALESCE($3::boolean, armed_pepper),
           armed_last   = COALESCE($4::boolean, armed_last)
         WHERE id = $5`,
        [flag(armed.lights), flag(armed.audio), flag(armed.pepper), flag(armed.last), devId]
      );
    }
    const status = await deviceStatusPayload(devId);
    const settings = await settingsPayload(devId);
    if (armed && typeof armed === "object") broadcast("status", status, devId);
    broadcast("settings", settings, devId);
    res.json({ settings, status });
  })
);

// ══════════════════════════════════════ DEVICE PAIRING ═══════════════════════
app.post(
  "/api/device/connect",
  requireUser,
  requireAdmin,
  wrap(async (req, res) => {
    const { ip } = req.body || {};
    if (!ip) return res.status(400).json({ error: "IP address required" });
    const d = (await db.one("SELECT owner FROM device WHERE id = 1")) || {};
    if (d.owner && d.owner !== req.user.username) {
      return res.status(409).json({ error: `Device is linked to "${d.owner}". Ask them to disconnect it first.` });
    }
    await db.query("UPDATE device SET ip = $1, owner = $2 WHERE id = 1", [String(ip), req.user.username]);
    const status = await deviceStatusPayload();
    broadcast("status", status);
    res.json(status);
  })
);

app.post(
  "/api/device/disconnect",
  requireUser,
  requireAdmin,
  wrap(async (req, res) => {
    const d = (await db.one("SELECT owner FROM device WHERE id = 1")) || {};
    if (d.owner && d.owner !== req.user.username) return res.status(403).json({ error: "Only the linking admin can disconnect this device" });
    await db.query("UPDATE device SET ip = NULL, owner = NULL, online = false WHERE id = 1");
    const status = await deviceStatusPayload();
    broadcast("status", status);
    res.json(status);
  })
);

app.get("/api/device/install-command", requireUser, requireAdmin, (req, res) => {
  // The device key is only ever shown to admins, once, for pasting into the Pi installer.
  res.json({ command: `curl -sSL https://ratavert.io/install | bash -s -- --device-key ${DEVICE_KEY} --backend ${req.protocol}://${req.get("host")}` });
});

// ══════════════════════════════════════ TRIGGERS (dashboard → Pi) ════════════
const lastFired = new Map(); // `${user}:${type}` -> timestamp

app.post(
  "/api/trigger",
  requireUser,
  wrap(async (req, res) => {
    const { type, duration } = req.body || {};
    if (!["lights", "audio", "pepper", "last"].includes(type)) return res.status(400).json({ error: "Invalid trigger type" });
    const devId = (await userDeviceId(req.user, req.body && req.body.device)) || (req.user.role === "admin" ? 1 : 0);
    if (!devId) return res.status(403).json({ error: "No device is assigned to your account" });
    const key = `${req.user.username}:${type}`;
    const last = lastFired.get(key) || 0;
    if (Date.now() - last < TRIGGER_COOLDOWN_MS) {
      return res.status(429).json({ error: `Cooldown active — wait ${Math.ceil((TRIGGER_COOLDOWN_MS - (Date.now() - last)) / 1000)}s before firing "${type}" again` });
    }
    lastFired.set(key, Date.now());

    const eventId = uuid();
    const cmdId = uuid();
    const now = new Date().toISOString();
    const dur = Number.isFinite(Number(duration)) && Number(duration) ? Number(duration) : 2;
    try {
      await db.tx(async (client) => {
        await client.query(
          `INSERT INTO trigger_events (id, type, status, source, is_rat, is_last, detail, requested_by, confidence, created_at, device_id)
           VALUES ($1,$2,'pending','manual',false,$3,'Manual test',$4,NULL,$5,$6)`,
          [eventId, type, type === "last", req.user.username, now, devId]
        );
        await client.query(
          `INSERT INTO commands (id, type, duration, status, trigger_event_id, created_at, device_id)
           VALUES ($1,$2,$3,'pending',$4,$5,$6)`,
          [cmdId, type, dur, eventId, now, devId]
        );
      });
    } catch (err) {
      lastFired.delete(key); // a failed attempt should not use up the cooldown
      throw err;
    }

    broadcast("trigger_requested", { id: eventId, type, status: "pending", user: req.user.username, ts: now }, devId);
    res.status(202).json({ id: eventId, status: "pending" });
  })
);

// ══════════════════════════════════════ LOGS / DETECTIONS / PHOTOS ═══════════
app.get(
  "/api/logs",
  requireUser,
  wrap(async (req, res) => {
        const since = toIso(req.query.since);
    const devId = await userDeviceId(req.user, req.query.device);

    const [detRows, trgRows] = await Promise.all([
      db.many(
        `SELECT * FROM detections
          WHERE ($1::timestamptz IS NULL OR "timestamp" > $1::timestamptz)
            AND ($3::int IS NULL OR device_id = $3::int)
          ORDER BY "timestamp" DESC LIMIT $2`,
        [since, limit, devId]
      ),
      db.many(
        `${TRIGGER_SELECT}
          WHERE ($1::timestamptz IS NULL OR t.created_at > $1::timestamptz)
            AND ($3::int IS NULL OR t.device_id = $3::int)
          ORDER BY t.created_at DESC LIMIT $2`,
        [since, limit, devId]
      ),
    ]);

    const merged = [...detRows.map(detectionToLogEntry), ...trgRows.map(triggerToLogEntry)]
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, limit);

    res.json(merged);
  })
);

app.get(
  "/api/detections",
  requireUser,
  wrap(async (req, res) => {
    const limit = parseLimit(req.query.limit, 60, 200);
    const since = toIso(req.query.since);
        const devId = await userDeviceId(req.user, req.query.device);
    const rows = await db.many(
      `SELECT * FROM detections
        WHERE ($1::timestamptz IS NULL OR "timestamp" > $1::timestamptz)
          AND ($3::int IS NULL OR device_id = $3::int)
        ORDER BY "timestamp" DESC LIMIT $2`,
      [since, limit, devId]
    );
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
          actionsFired: Array.isArray(d.actions_fired) ? d.actions_fired : [],
          escalated: !!d.escalated,
          type: isManual ? "capture" : d.escalated ? "last" : "pepper",
          isRat: !isManual,
          capturedBy: isManual ? d.captured_by : null,
        };
      })
    );
  })
);

app.get(
  "/api/analytics/hourly",
  requireUser,
  wrap(async (req, res) => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const devId = await userDeviceId(req.user, req.query.device);
    const rows = await db.many(
      "SELECT type, created_at FROM trigger_events WHERE created_at > $1 AND status != 'fail' AND ($2::int IS NULL OR device_id = $2::int)",
      [since, devId]
    );
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
  })
);

// Admin-only, aggregate-only report — per FR-6x this summarizes device
// connectivity and deterrence trends across the week. Deliberately does NOT
// expose individual detection photos or a per-event log; that's the
// registered user's own view (Activity/Analytics), not the admin's.
// (Kept for backward compatibility — the Device Reports page below uses the
// stored weekly_reports snapshots instead of this live aggregate.)
app.get(
  "/api/admin/weekly-report",
  requireUser,
  requireAdmin,
  wrap(async (req, res) => {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const until = new Date().toISOString();

    const device = (await db.one("SELECT * FROM device WHERE id = 1")) || {};
    const detectionStats = await db.one(
      `SELECT COUNT(*)::int AS total, (COUNT(*) FILTER (WHERE escalated))::int AS escalated
         FROM detections WHERE created_at >= $1 AND source != 'manual'`,
      [since]
    );
    const triggerRows = await db.many(
      "SELECT type, status, COUNT(*)::int AS c FROM trigger_events WHERE created_at >= $1 GROUP BY type, status",
      [since]
    );
    const deterrence = {};
    for (const r of triggerRows) {
      if (!deterrence[r.type]) deterrence[r.type] = { ok: 0, fail: 0 };
      if (r.status === "ok") deterrence[r.type].ok += r.c;
      else if (r.status === "fail") deterrence[r.type].fail += r.c;
    }

    res.json({
      generated_at: until,
      period: { since, until },
      device: { online: !!device.online, ip: device.ip || null, owner: device.owner || null, last_seen: device.last_seen || null },
      detections: { total: detectionStats.total, escalated: detectionStats.escalated },
      deterrence,
    });
  })
);

// ══════════════════════════════════════ DEVICE REPORTS (stored snapshots) ═══
// Backs the admin "Device Reports" page (Weekly tab). Reads/writes the
// weekly_reports table.
app.get(
  "/api/admin/weekly-reports",
  requireUser,
  requireAdmin,
  wrap(async (req, res) => {
    const rows = await db.many(
      `SELECT id, device_owner, device_ip, period_since, period_until, generated_at, detections_total, detections_escalated
         FROM weekly_reports ORDER BY generated_at DESC`
    );
    res.json(rows);
  })
);

app.get(
  "/api/admin/weekly-reports/:id",
  requireUser,
  requireAdmin,
  wrap(async (req, res) => {
    const row = await db.one("SELECT * FROM weekly_reports WHERE id = $1", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Report not found" });
    // deterrence_json and entries_json are sent as JSON *text*, exactly as the
    // original API did, so the dashboard keeps working unchanged.
    res.json({
      ...row,
      deterrence_json: JSON.stringify(row.deterrence_json ?? {}),
      entries_json: JSON.stringify(row.entries_json ?? []),
      entries: Array.isArray(row.entries_json) ? row.entries_json : [],
    });
  })
);

app.post(
  "/api/admin/weekly-reports/generate",
  requireUser,
  requireAdmin,
  wrap(async (req, res) => {
        const devs = await db.many("SELECT id FROM device ORDER BY id");
    let id = null;
    for (const d of devs) id = await generateWeeklyReport(d.id);
    res.status(201).json({ id });
  })
);

const PHOTO_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
app.get(
  "/api/photos/:id",
  wrap(async (req, res) => {
    const id = req.params.id;
    if (!PHOTO_ID_RE.test(id)) return res.status(404).json({ error: "Photo not found" });
    const { data, error } = await photoBucket().download(`${id}.jpg`);
    if (error || !data) {
      const notFound =
        !error || error.status === 404 || String(error.statusCode) === "404" || /not.?found/i.test(error.message || "");
      if (notFound) return res.status(404).json({ error: "Photo not found" });
      console.error("[storage] download failed:", error.message);
      return res.status(502).json({ error: "Photo storage unavailable" });
    }
    const buf = Buffer.from(await data.arrayBuffer());
    res.set({ "Content-Type": "image/jpeg", "Content-Length": String(buf.length), "Cache-Control": "public, max-age=86400" });
    res.send(buf);
  })
);

// ══════════════════════════════════════ PI → BACKEND ══════════════════════════
app.post(
  "/api/pi/heartbeat",
  requireDevice,
  wrap(async (req, res) => {
    const { online, ip, armed, last_seen } = req.body || {};
    const flag = (v) => (v === undefined ? null : !!v);
    await db.query(
      `UPDATE device SET
         online       = $1,
         ip           = COALESCE($2, ip),
         armed_lights = COALESCE($3::boolean, armed_lights),
         armed_audio  = COALESCE($4::boolean, armed_audio),
         armed_pepper = COALESCE($5::boolean, armed_pepper),
         armed_last   = COALESCE($6::boolean, armed_last),
            last_seen    = $7
       WHERE id = $8`,
      [
        online !== false,
        ip ? String(ip) : null,
        flag(armed?.lights),
        flag(armed?.audio),
        flag(armed?.pepper),
        flag(armed?.last),
            toIso(last_seen) || new Date().toISOString(),
        req.deviceId,
      ]
    );
    broadcast("status", await deviceStatusPayload(req.deviceId), req.deviceId);
    res.json({ ok: true });
  })
);

app.post(
  "/api/pi/photos",
  requireDevice,
  upload.single("photo"),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No photo uploaded (field name must be 'photo')" });
    const id = uuid();
    const { error } = await photoBucket().upload(`${id}.jpg`, req.file.buffer, { contentType: "image/jpeg", upsert: false });
    if (error) {
      console.error("[storage] upload failed:", error.message);
      return res.status(502).json({ error: "Photo storage failed" });
    }
    res.status(201).json({ photo_id: id, photo_url: `/api/photos/${id}` });
  })
);

const INSERT_AUTO_TRIGGER = `
  INSERT INTO trigger_events
    (id, type, status, source, is_rat, is_last, detail, requested_by, detection_id, confidence, fired_at, created_at, device_id)
  VALUES ($1,$2,'ok','auto',false,$3,$4,'auto-detect',$5,$6,$7,$8,$9)`;

app.post(
  "/api/pi/detections",
  requireDevice,
  wrap(async (req, res) => {
    const { timestamp, confidence, photo_url, actions_fired, escalated_to_last_resort } = req.body || {};
    if (!timestamp) return res.status(400).json({ error: "timestamp is required" });
    const tsIso = toIso(timestamp);
    if (!tsIso) return res.status(400).json({ error: "timestamp is not a valid date" });

    const actions = Array.isArray(actions_fired) ? actions_fired.map(String) : [];
    const conf = toNumberOrNull(confidence);
    const escalated = !!escalated_to_last_resort;
    const id = uuid();
    const now = new Date().toISOString();
    const photoPath = photo_url ? `${path.basename(String(photo_url))}.jpg` : null;

    await db.tx(async (client) => {
      await client.query(
        `INSERT INTO detections (id, "timestamp", confidence, photo_path, actions_fired, escalated, created_at, device_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
        [id, tsIso, conf, photoPath, JSON.stringify(actions), escalated, now, req.deviceId]
      );
      for (const type of actions) {
        await client.query(INSERT_AUTO_TRIGGER, [uuid(), type, type === "last", "Auto-response: rat detected", id, conf, tsIso, now, req.deviceId]);
      }
      if (escalated && !actions.includes("last")) {
        await client.query(INSERT_AUTO_TRIGGER, [uuid(), "last", true, "Horn — escalating", id, conf, tsIso, now, req.deviceId]);
      }
    });

    const detRow = await db.one("SELECT * FROM detections WHERE id = $1", [id]);
    broadcast("detection", detectionToLogEntry(detRow), req.deviceId);
    res.status(201).json({ id });
  })
);

app.post(
  "/api/pi/ack",
  requireDevice,
  wrap(async (req, res) => {
    const { type, status, fired_at, command_id } = req.body || {};
        let row = command_id ? await db.one("SELECT * FROM commands WHERE id = $1 AND device_id = $2", [String(command_id), req.deviceId]) : null;
    if (!row) {
      row = await db.one("SELECT * FROM commands WHERE type = $1 AND status != 'done' AND device_id = $2 ORDER BY created_at DESC LIMIT 1", [
        type === undefined || type === null ? null : String(type),
        req.deviceId,
      ]);
    }
    if (!row) return res.status(404).json({ error: "No matching pending command" });

    const firedIso = toIso(fired_at) || new Date().toISOString();
    await db.tx(async (client) => {
      await client.query("UPDATE commands SET status = 'done' WHERE id = $1", [row.id]);
      if (row.trigger_event_id) {
        await client.query("UPDATE trigger_events SET status = $1, fired_at = $2 WHERE id = $3", [
          status === "ok" ? "ok" : "fail",
          firedIso,
          row.trigger_event_id,
        ]);
      }
    });

    if (row.trigger_event_id) {
      const t = await db.one(`${TRIGGER_SELECT} WHERE t.id = $1`, [row.trigger_event_id]);
      if (t) broadcast("trigger_ack", triggerToLogEntry(t), req.deviceId);
    }
    res.json({ ok: true });
  })
);

// Pi polls this instead of running its own server — works from behind NAT/firewalls.
// The claim is one atomic statement, so a command is never handed out twice.
app.get(
  "/api/pi/commands",
  requireDevice,
  wrap(async (req, res) => {
    const rows = await db.many(
      `UPDATE commands SET status = 'delivered'
        WHERE id IN (
          SELECT id FROM commands WHERE status = 'pending' AND device_id = $1
          ORDER BY created_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED
        )
        RETURNING id, type, duration, created_at`,
      [req.deviceId]
    );
    rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    res.json(rows.map((c) => ({ id: c.id, type: c.type, duration: c.duration })));
  })
);

// ── health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── error handler (must be last) ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.message });
  }
  if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
  console.error("[error]", req.method, req.originalUrl, err);
  res.status(500).json({ error: "Internal server error" });
});

// ── background jobs ──────────────────────────────────────────────────────────
// Note: on a free host that goes to sleep these timers pause until the next request wakes it.
function startBackgroundJobs() {
  // Mark the device offline if its heartbeat has gone silent.
  let checkingOffline = false;
  setInterval(async () => {
    if (checkingOffline) return;
    checkingOffline = true;
    try {
      const cutoff = new Date(Date.now() - OFFLINE_AFTER_MS);
        const { rows } = await db.query(
        "UPDATE device SET online = false WHERE online = true AND last_seen IS NOT NULL AND last_seen < $1 RETURNING id",
        [cutoff]
      );
      for (const r of rows) broadcast("status", await deviceStatusPayload(r.id), r.id);
    } catch (err) {
      console.error("[offline-check]", err.message);
    } finally {
      checkingOffline = false;
    }
  }, 5000);

  // Auto-generate a snapshot every Sunday at 00:00, once per day at most.
  let lastAutoGenDate = null;
  setInterval(async () => {
    const now = new Date();
    if (now.getDay() !== 0 || now.getHours() !== 0) return;
    const today = now.toDateString();
    if (lastAutoGenDate === today) return;
    lastAutoGenDate = today; // claim the day first so overlapping ticks cannot create two reports
    try {
      const devs = await db.many("SELECT id FROM device ORDER BY id");
      for (const d of devs) await generateWeeklyReport(d.id);
    } catch (err) {
      lastAutoGenDate = null; // try again on the next tick
      console.error("[weekly-report]", err.message);
    }
  }, 60000);
}

function shutdown(signal) {
  console.log(`[shutdown] ${signal} received`);
  wss.clients.forEach((c) => c.terminate());
  server.close(() => db.pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

async function main() {
  await db.init();
  try {
    const { error } = await supabase.storage.getBucket(PHOTO_BUCKET);
    if (error) {
      console.warn(`[storage] Could not find bucket "${PHOTO_BUCKET}" (${error.message}). Create a private bucket with that name in Supabase Storage.`);
    } else {
      console.log(`[storage] Using bucket "${PHOTO_BUCKET}".`);
    }
  } catch (err) {
    console.warn("[storage] Bucket check failed:", err.message);
  }
  startBackgroundJobs();
  server.listen(PORT, () => console.log(`RatAvert backend listening on :${PORT}`));
}
main().catch((err) => {
  console.error("Startup failed:", err.message);
  process.exit(1);
});
