const crypto = require("crypto");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

// DATABASE_URL is the Supabase *Session pooler* connection string (port 5432).
// Supabase uses its own certificate authority, so we turn TLS on without
// checking the certificate chain. Set DATABASE_SSL=false only for a local
// Postgres that has no TLS.
let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL. Copy .env.example to .env and fill it in.");
  process.exit(1);
}
// An "sslmode=" in the URL would override the ssl setting below, so drop it.
connectionString = connectionString
  .replace(/([?&])sslmode=[^&]*&?/i, "$1")
  .replace(/[?&]$/, "");

const useSsl = !/^(false|0|off|disable)$/i.test(process.env.DATABASE_SSL || "");

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  max: Number(process.env.DB_POOL_MAX) || 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
});

// A dropped idle connection (for example after Render wakes up) must not crash the server.
pool.on("error", (err) => console.error("[db] idle connection error:", err.message));

const query = (text, params) => pool.query(text, params);
const many = async (text, params) => (await pool.query(text, params)).rows;
const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;

// Run several statements as one all-or-nothing unit.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* the original error is the one that matters */
    }
    throw err;
  } finally {
    client.release();
  }
}

// Called once at startup, before the server accepts requests.
async function init() {
  try {
    await pool.query("INSERT INTO device (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
    await pool.query("INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");

    // Seed a first admin account only if the accounts table is completely empty.
    const { c } = await one("SELECT COUNT(*)::int AS c FROM accounts");
    if (c === 0) {
      const username = (process.env.SEED_ADMIN_USERNAME || "admin").toLowerCase();
      let password = process.env.SEED_ADMIN_PASSWORD;
      let generated = false;
      if (!password) {
        // Never fall back to a well-known default password.
        password = crypto.randomBytes(12).toString("hex");
        generated = true;
      }
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        `INSERT INTO accounts (username, password_hash, role, active, created_at)
         VALUES ($1, $2, 'admin', true, $3) ON CONFLICT (username) DO NOTHING`,
        [username, hash, new Date().toISOString()]
      );
      console.log(`[seed] Created initial admin account "${username}". Change its password after first login.`);
      if (generated) {
        console.log(`[seed] SEED_ADMIN_PASSWORD was not set, so a one-time password was generated: ${password}`);
      }
    }
  } catch (err) {
    if (err && err.code === "42P01") {
      throw new Error(
        'The database tables do not exist yet. Run supabase/schema.sql in the Supabase SQL Editor first.'
      );
    }
    throw err;
  }
}

module.exports = { pool, query, many, one, tx, init };
