const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

/*
  ==========================================
  KONEKSI NEON POSTGRESQL
  ==========================================
*/

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL belum diatur.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Tes koneksi database saat server mulai
pool.query("SELECT NOW()")
  .then(() => {
    console.log("Terhubung ke Neon PostgreSQL.");
  })
  .catch((err) => {
    console.error("Gagal terhubung ke Neon:", err.message);
  });


/*
  ==========================================
  MIDDLEWARE
  ==========================================
*/

app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "neon-spin-demo-change-me",
    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);


/*
  ==========================================
  FILE STATIC
  ==========================================
*/

const path = require("path");

app.use(
  express.static(path.join(__dirname, "public"))
);


/*
  ==========================================
  AUTHENTICATION
  ==========================================
*/

function auth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
      error: "Belum login."
    });
  }

  next();
}


/*
  ==========================================
  REGISTER
  ==========================================
*/

app.post("/api/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    // Validasi username
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({
        error:
          "Username 3-20 karakter: huruf, angka, underscore."
      });
    }

    // Validasi password
    if (password.length < 6) {
      return res.status(400).json({
        error: "Password minimal 6 karakter."
      });
    }

    // Cek username
    const cek = await pool.query(
      `
      SELECT id
      FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1
      `,
      [username]
    );

    if (cek.rows.length > 0) {
      return res.status(409).json({
        error: "Username sudah digunakan."
      });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // Simpan user ke Neon
    const hasil = await pool.query(
      `
      INSERT INTO users
        (username, password_hash, virtual_coins)
      VALUES
        ($1, $2, $3)
      RETURNING
        id,
        username,
        virtual_coins,
        created_at
      `,
      [
        username,
        password_hash,
        10000
      ]
    );

    const user = hasil.rows[0];

    // Login otomatis
    req.session.userId = user.id;

    res.json({
      ok: true
    });

  } catch (err) {
    console.error("REGISTER ERROR:", err);

    // Username duplicate
    if (err.code === "23505") {
      return res.status(409).json({
        error: "Username sudah digunakan."
      });
    }

    res.status(500).json({
      error: "Terjadi kesalahan server."
    });
  }
});


/*
  ==========================================
  LOGIN
  ==========================================
*/

app.post("/api/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const hasil = await pool.query(
      `
      SELECT
        id,
        username,
        password_hash,
        virtual_coins,
        created_at
      FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1
      `,
      [username]
    );

    const user = hasil.rows[0];

    if (
      !user ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      return res.status(401).json({
        error: "Username atau password salah."
      });
    }

    req.session.userId = user.id;

    res.json({
      ok: true
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);

    res.status(500).json({
      error: "Terjadi kesalahan server."
    });
  }
});


/*
  ==========================================
  LOGOUT
  ==========================================
*/

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      ok: true
    });
  });
});


/*
  ==========================================
  DATA USER / ME
  ==========================================
*/

app.get("/api/me", auth, async (req, res) => {
  try {
    const hasil = await pool.query(
      `
      SELECT
        id,
        username,
        virtual_coins,
        created_at
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.session.userId]
    );

    const user = hasil.rows[0];

    if (!user) {
      return res.status(401).json({
        error: "User tidak ditemukan."
      });
    }

    res.json({
      id: user.id,
      username: user.username,
      virtual_coins: user.virtual_coins,
      created_at: user.created_at
    });

  } catch (err) {
    console.error("ME ERROR:", err);

    res.status(500).json({
      error: "Terjadi kesalahan server."
    });
  }
});


/*
  ==========================================
  HISTORY
  ==========================================
*/

app.get("/api/history", auth, async (req, res) => {
  try {
    const hasil = await pool.query(
      `
      SELECT
        id,
        user_id,
        result,
        bet_virtual,
        payout_virtual,
        created_at
      FROM spins
      WHERE user_id = $1
      ORDER BY id DESC
      LIMIT 20
      `,
      [req.session.userId]
    );

    res.json(hasil.rows);

  } catch (err) {
    console.error("HISTORY ERROR:", err);

    res.status(500).json({
      error: "Terjadi kesalahan server."
    });
  }
});


/*
  ==========================================
  SLOT GAME
  ==========================================
*/

const symbols = [
  "🍒",
  "🔔",
  "7️⃣",
  "💎",
  "BAR",
  "⭐"
];

const multipliers = {
  "💎": 25,
  "7️⃣": 20,
  "🔔": 12,
  "🍒": 8,
  "BAR": 5,
  "⭐": 3
};


/*
  ==========================================
  SPIN
  ==========================================
*/

app.post("/api/spin", auth, async (req, res) => {

  const bet = Math.floor(Number(req.body.bet));

  // Validasi taruhan
  if (
    !Number.isFinite(bet) ||
    bet < 10 ||
    bet > 100000
  ) {
    return res.status(400).json({
      error:
        "Bet harus antara 10 dan 100.000 koin virtual."
    });
  }

  const client = await pool.connect();

  try {

    /*
      Mulai transaksi.

      Dengan transaksi:
      - saldo dikunci
      - saldo diperbarui
      - hasil spin disimpan

      Semua berhasil bersama-sama.
    */

    await client.query("BEGIN");


    /*
      Ambil user dan LOCK barisnya.

      FOR UPDATE mencegah dua spin bersamaan
      mengubah saldo secara tidak aman.
    */

    const userResult = await client.query(
      `
      SELECT
        id,
        username,
        virtual_coins,
        created_at
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [req.session.userId]
    );

    const user = userResult.rows[0];

    if (!user) {
      await client.query("ROLLBACK");

      return res.status(401).json({
        error: "User tidak ditemukan."
      });
    }


    /*
      Cek saldo
    */

    if (bet > user.virtual_coins) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Saldo virtual tidak cukup."
      });
    }


    /*
      ======================================
      RANDOM REELS
      ======================================
    */

    const reels = Array.from(
      { length: 9 },
      () =>
        symbols[
          Math.floor(Math.random() * symbols.length)
        ]
    );


    /*
      ======================================
      PAYLINE
      ======================================
    */

    const lines = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8]
    ];


    /*
      ======================================
      HITUNG PEMBAYARAN
      ======================================
    */

    let payout = 0;
    let matched = [];

    for (const line of lines) {

      const [a, b, c] = line;

      if (
        reels[a] === reels[b] &&
        reels[b] === reels[c]
      ) {

        const p =
          bet * (multipliers[reels[a]] || 3);

        // Ambil payout terbesar
        if (p > payout) {
          payout = p;
          matched = line;
        }
      }
    }


    /*
      ======================================
      HITUNG SALDO BARU
      ======================================
    */

    const newBalance =
      user.virtual_coins - bet + payout;


    /*
      ======================================
      UPDATE SALDO USER
      ======================================
    */

    await client.query(
      `
      UPDATE users
      SET virtual_coins = $1
      WHERE id = $2
      `,
      [
        newBalance,
        user.id
      ]
    );


    /*
      ======================================
      SIMPAN HISTORY SPIN
      ======================================
    */

    await client.query(
      `
      INSERT INTO spins
        (
          user_id,
          result,
          bet_virtual,
          payout_virtual
        )
      VALUES
        ($1, $2, $3, $4)
      `,
      [
        user.id,
        JSON.stringify(reels),
        bet,
        payout
      ]
    );


    /*
      Selesai transaksi
    */

    await client.query("COMMIT");


    /*
      Kirim hasil ke game
    */

    res.json({
      reels,
      payout,
      balance: newBalance,
      matched
    });

  } catch (err) {

    /*
      Jika terjadi error,
      batalkan semua perubahan.
    */

    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "ROLLBACK ERROR:",
        rollbackError
      );
    }

    console.error("SPIN ERROR:", err);

    res.status(500).json({
      error: "Terjadi kesalahan saat spin."
    });

  } finally {

    // Kembalikan koneksi ke pool
    client.release();
  }
});


/*
  ==========================================
  HEALTH CHECK
  ==========================================
*/

app.get("/api/health", async (req, res) => {
  try {

    const result = await pool.query(
      "SELECT NOW() AS waktu"
    );

    res.json({
      ok: true,
      database: "Neon PostgreSQL",
      waktu: result.rows[0].waktu
    });

  } catch (err) {

    console.error("HEALTH ERROR:", err);

    res.status(500).json({
      ok: false,
      database: "Tidak terhubung"
    });
  }
});


/*
  ==========================================
  START SERVER
  ==========================================
*/

module.exports = app;
