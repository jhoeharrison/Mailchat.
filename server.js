require("dotenv").config();

const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("render.com")
    ? { rejectUnauthorized: false } : undefined
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.set("trust proxy", 1);
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || "replace-this-secret-before-deploying",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 });
const messageLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60 });

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(60) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body VARCHAR(2000) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (sender_id <> receiver_id)
    );
    CREATE INDEX IF NOT EXISTS messages_pair_idx
      ON messages (sender_id, receiver_id, created_at);
  `);
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please sign in first." });
  next();
}

app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (name.length < 2 || name.length > 60) return res.status(400).json({ error: "Name must be 2–60 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 8 || password.length > 72) return res.status(400).json({ error: "Password must be at least 8 characters." });

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email",
      [name, email, hash]
    );
    req.session.userId = result.rows[0].id;
    res.json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "That email already has a MailChat account." });
    console.error(err);
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const result = await pool.query("SELECT id, name, email, password_hash FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect." });
    }
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: "Could not start your session." });
      req.session.userId = user.id;
      res.json({ user: { id: user.id, name: user.name, email: user.email } });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not sign in." });
  }
});

app.post("/api/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", requireAuth, async (req, res) => {
  const result = await pool.query("SELECT id, name, email FROM users WHERE id = $1", [req.session.userId]);
  if (!result.rows[0]) return res.status(401).json({ error: "Account not found." });
  res.json({ user: result.rows[0] });
});

app.get("/api/users", requireAuth, async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (q.length < 2) return res.json({ users: [] });
  const result = await pool.query(
    `SELECT id, name, email FROM users
     WHERE id <> $1 AND (LOWER(name) LIKE $2 OR LOWER(email) LIKE $2)
     ORDER BY name LIMIT 20`,
    [req.session.userId, `%${q}%`]
  );
  res.json({ users: result.rows });
});

app.get("/api/messages/:userId", requireAuth, async (req, res) => {
  const otherId = Number(req.params.userId);
  if (!Number.isSafeInteger(otherId) || otherId <= 0 || otherId === Number(req.session.userId)) {
    return res.status(400).json({ error: "Invalid chat." });
  }
  const exists = await pool.query("SELECT id FROM users WHERE id = $1", [otherId]);
  if (!exists.rows.length) return res.status(404).json({ error: "User not found." });

  const result = await pool.query(
    `SELECT id, sender_id, receiver_id, body, created_at
     FROM messages
     WHERE (sender_id = $1 AND receiver_id = $2)
        OR (sender_id = $2 AND receiver_id = $1)
     ORDER BY created_at ASC LIMIT 300`,
    [req.session.userId, otherId]
  );
  res.json({ messages: result.rows });
});

app.post("/api/messages", requireAuth, messageLimiter, async (req, res) => {
  const receiverId = Number(req.body.receiverId);
  const body = String(req.body.body || "").trim();
  if (!Number.isSafeInteger(receiverId) || receiverId <= 0 || receiverId === Number(req.session.userId)) {
    return res.status(400).json({ error: "Choose a valid recipient." });
  }
  if (!body || body.length > 2000) return res.status(400).json({ error: "Message must be 1–2000 characters." });
  const result = await pool.query("SELECT id FROM users WHERE id = $1", [receiverId]);
  if (!result.rows.length) return res.status(404).json({ error: "Recipient not found." });
  const sent = await pool.query(
    "INSERT INTO messages (sender_id, receiver_id, body) VALUES ($1, $2, $3) RETURNING id, sender_id, receiver_id, body, created_at",
    [req.session.userId, receiverId, body]
  );
  res.json({ message: sent.rows[0] });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

initDb().then(() => {
  app.listen(PORT, () => console.log(`MailChat running on port ${PORT}`));
}).catch(err => {
  console.error("Database setup failed:", err);
  process.exit(1);
});
