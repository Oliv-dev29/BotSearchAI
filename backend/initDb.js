require("dotenv").config();
const db = require("./db");
const bcrypt = require("bcryptjs");

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_subscriptions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    INTEGER NOT NULL,
    blood_type TEXT    NOT NULL,
    created_at TEXT    DEFAULT (datetime('now')),
    expires_at TEXT    NOT NULL,
    UNIQUE(chat_id, blood_type)
  );
  CREATE INDEX IF NOT EXISTS idx_subs_blood_type ON bot_subscriptions(blood_type);
  CREATE INDEX IF NOT EXISTS idx_subs_expires    ON bot_subscriptions(expires_at);

  CREATE TABLE IF NOT EXISTS centers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quartier TEXT,
    zone TEXT,
    phone TEXT,
    hours TEXT,
    lat REAL,
    lng REAL,
    is_open INTEGER DEFAULT 1,
    threshold_critique INTEGER DEFAULT 3,
    threshold_faible INTEGER DEFAULT 6,
    last_updated TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS blood_stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    center_id INTEGER REFERENCES centers(id) ON DELETE CASCADE,
    blood_type TEXT NOT NULL,
    quantity INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(center_id, blood_type)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'agent',
    center_id INTEGER REFERENCES centers(id) ON DELETE SET NULL,
    is_active INTEGER DEFAULT 0,
    must_change_password INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    center_id INTEGER REFERENCES centers(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    blood_type TEXT NOT NULL,
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    quantity_before INTEGER NOT NULL,
    quantity_after INTEGER NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Migration compatible avec les bases SQLite déjà existantes.
const usersColumns = db.prepare("PRAGMA table_info(users)").all();
const hasMustChangePasswordColumn = usersColumns.some(
  (column) => column.name === "must_change_password",
);

if (!hasMustChangePasswordColumn) {
  db.prepare(
    "ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0",
  ).run();
  console.log("Colonne users.must_change_password ajoutée.");
  db.prepare(
    "UPDATE users SET must_change_password = 1 WHERE username = 'admin'",
  ).run();
}

// Seed des centres (si la table est vide)
const count = db.prepare("SELECT COUNT(*) as n FROM centers").get().n;
if (count === 0) {
  const insertCenter = db.prepare(`
    INSERT INTO centers (name, quartier, zone, phone, hours, lat, lng, is_open, threshold_critique, threshold_faible, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertStock = db.prepare(`
    INSERT INTO blood_stock (center_id, blood_type, quantity) VALUES (?, ?, ?)
  `);

  const seedCenters = [
    {
      name: "CNHU Hubert Maga",
      quartier: "Cadjehoun",
      zone: "Cotonou",
      phone: "+229 21 30 01 55",
      hours: "24h/24",
      lat: 6.3654,
      lng: 2.4183,
      is_open: 1,
      stock: {
        "O+": 12,
        "O-": 2,
        "A+": 8,
        "A-": 0,
        "B+": 5,
        "B-": 0,
        "AB+": 3,
        "AB-": 1,
      },
    },
    {
      name: "Centre de Transfusion Sanguine de Menontin",
      quartier: "Menontin",
      zone: "Cotonou",
      phone: "+229 21 33 10 10",
      hours: "Lun-Sam 07h30-18h00",
      lat: 6.378,
      lng: 2.425,
      is_open: 1,
      stock: {
        "O+": 0,
        "O-": 0,
        "A+": 6,
        "A-": 0,
        "B+": 0,
        "B-": 4,
        "AB+": 9,
        "AB-": 0,
      },
    },
    {
      name: "Hopital de Zone d'Abomey-Calavi",
      quartier: "Abomey-Calavi",
      zone: "Abomey-Calavi",
      phone: "+229 21 36 00 70",
      hours: "24h/24",
      lat: 6.4489,
      lng: 2.3558,
      is_open: 1,
      stock: {
        "O+": 9,
        "O-": 1,
        "A+": 0,
        "A-": 0,
        "B+": 4,
        "B-": 0,
        "AB+": 0,
        "AB-": 0,
      },
    },
    {
      name: "Hopital Saint-Luc de Cotonou",
      quartier: "Akpakpa",
      zone: "Cotonou",
      phone: "+229 21 33 13 31",
      hours: "Lun-Ven 08h00-17h00",
      lat: 6.3533,
      lng: 2.4417,
      is_open: 0,
      stock: {
        "O+": 0,
        "O-": 0,
        "A+": 0,
        "A-": 3,
        "B+": 0,
        "B-": 0,
        "AB+": 0,
        "AB-": 2,
      },
    },
  ];

  const seedAll = db.transaction(() => {
    for (const c of seedCenters) {
      const { lastInsertRowid: centerId } = insertCenter.run(
        c.name,
        c.quartier,
        c.zone,
        c.phone,
        c.hours,
        c.lat,
        c.lng,
        c.is_open,
        3,
        6,
        new Date().toISOString(),
      );
      for (const [type, qty] of Object.entries(c.stock)) {
        insertStock.run(centerId, type, qty);
      }
    }
  });
  seedAll();
  console.log("Centres seedés.");
}

// Créer le compte admin s'il n'existe pas
const adminExists = db
  .prepare("SELECT id FROM users WHERE username = 'admin'")
  .get();
if (!adminExists) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error("ADMIN_PASSWORD manquant dans .env");
    process.exit(1);
  }
  const hash = bcrypt.hashSync(adminPassword, 12);
  db.prepare(
    "INSERT INTO users (username, password_hash, role, center_id, is_active, must_change_password) VALUES ('admin', ?, 'admin', NULL, 1, 1)",
  ).run(hash);
  console.log("Compte admin créé.");
}

console.log("Base de données initialisée.");
