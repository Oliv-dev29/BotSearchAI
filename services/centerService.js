const db = require('../backend/db');
const { notifyIfRestocked } = require('./notificationService');

const BLOOD_TYPES = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeLevel(quantity, thresholdCritique, thresholdFaible) {
  if (quantity === 0) return 'rupture';
  if (quantity <= thresholdCritique) return 'critique';
  if (quantity <= thresholdFaible) return 'faible';
  return 'stable';
}

function buildCenter(row, stockRows) {
  const stock = {};
  for (const s of stockRows) {
    stock[s.blood_type] = {
      quantity: s.quantity,
      level: computeLevel(s.quantity, row.threshold_critique, row.threshold_faible)
    };
  }
  for (const t of BLOOD_TYPES) {
    if (!stock[t]) stock[t] = { quantity: 0, level: 'rupture' };
  }

  const available = BLOOD_TYPES.filter(t => stock[t].quantity > 0);

  const alerts = [];
  for (const t of BLOOD_TYPES) {
    const s = stock[t];
    if (s.level === 'rupture') alerts.push({ type: t, level: 'rupture', message: `Rupture ${t}` });
    else if (s.level === 'critique') alerts.push({ type: t, level: 'critique', message: `Stock critique ${t} : ${s.quantity} poche(s)` });
  }

  return {
    id: row.id,
    name: row.name,
    quartier: row.quartier,
    zone: row.zone,
    phone: row.phone,
    hours: row.hours,
    lat: row.lat,
    lng: row.lng,
    isOpen: row.is_open === 1,
    thresholds: { critique: row.threshold_critique, faible: row.threshold_faible },
    lastUpdated: row.last_updated,
    stock,
    available,
    alerts
  };
}

// ─── Lecture ──────────────────────────────────────────────────────────────────

function getAll() {
  const centers = db.prepare('SELECT * FROM centers ORDER BY id').all();
  const stocks = db.prepare('SELECT * FROM blood_stock').all();
  return centers.map(c => buildCenter(c, stocks.filter(s => s.center_id === c.id)));
}

function getById(id) {
  const row = db.prepare('SELECT * FROM centers WHERE id = ?').get(id);
  if (!row) return null;
  const stocks = db.prepare('SELECT * FROM blood_stock WHERE center_id = ?').all(id);
  return buildCenter(row, stocks);
}

// ─── Mise à jour stock ────────────────────────────────────────────────────────

function updateStock(id, stockUpdates, isOpen) {
  const center = db.prepare('SELECT * FROM centers WHERE id = ?').get(id);
  if (!center) return null;

  // Snapshot des quantités actuelles avant modification (pour détecter les restocks)
  const before = {};
  db.prepare('SELECT blood_type, quantity FROM blood_stock WHERE center_id = ?').all(id)
    .forEach(r => { before[r.blood_type] = r.quantity; });

  const upsertStock = db.prepare(`
    INSERT INTO blood_stock (center_id, blood_type, quantity, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(center_id, blood_type) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at
  `);

  const run = db.transaction(() => {
    for (const [type, qty] of Object.entries(stockUpdates)) {
      if (!BLOOD_TYPES.includes(type)) continue;
      upsertStock.run(id, type, parseInt(qty) || 0);
    }
    if (typeof isOpen === 'boolean') {
      db.prepare("UPDATE centers SET is_open = ?, last_updated = datetime('now') WHERE id = ?").run(isOpen ? 1 : 0, id);
    } else {
      db.prepare("UPDATE centers SET last_updated = datetime('now') WHERE id = ?").run(id);
    }
  });
  run();

  const result = getById(id);

  // Notifications post-transaction : fire-and-forget pour ne pas bloquer la réponse HTTP
  for (const [type, qty] of Object.entries(stockUpdates)) {
    if (!BLOOD_TYPES.includes(type)) continue;
    const qBefore = before[type] ?? 0;
    const qAfter = parseInt(qty) || 0;
    notifyIfRestocked(type, qBefore, qAfter, center.name)
      .catch(err => console.error('Notification updateStock error:', err.message));
  }

  return result;
}

// ─── Mouvement ────────────────────────────────────────────────────────────────

function addMovement(centerId, type, bloodType, quantity, note, userId = null) {
  if (!BLOOD_TYPES.includes(bloodType)) return null;

  const center = getById(centerId);
  if (!center) return null;

  const current = center.stock[bloodType]?.quantity ?? 0;
  const newQuantity = type === 'entree' ? current + quantity : Math.max(0, current - quantity);

  const upsertStock = db.prepare(`
    INSERT INTO blood_stock (center_id, blood_type, quantity, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(center_id, blood_type) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at
  `);

  let movementId;
  const run = db.transaction(() => {
    upsertStock.run(centerId, bloodType, newQuantity);
    db.prepare("UPDATE centers SET last_updated = datetime('now') WHERE id = ?").run(centerId);
    const result = db.prepare(`
      INSERT INTO movements (center_id, user_id, blood_type, type, quantity, quantity_before, quantity_after, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(centerId, userId, bloodType, type, quantity, current, newQuantity, note || null);
    movementId = result.lastInsertRowid;
  });
  run();

  // Notification post-transaction si restock : fire-and-forget
  notifyIfRestocked(bloodType, current, newQuantity, center.name)
    .catch(err => console.error('Notification addMovement error:', err.message));

  const movement = db.prepare('SELECT * FROM movements WHERE id = ?').get(movementId);
  return {
    center: getById(centerId),
    movement: { ...movement, centerName: center.name, date: movement.created_at }
  };
}

// ─── Historique des mouvements ────────────────────────────────────────────────

function getMovements(centerId) {
  const rows = centerId
    ? db.prepare('SELECT m.*, c.name AS center_name FROM movements m JOIN centers c ON c.id = m.center_id WHERE m.center_id = ? ORDER BY m.created_at DESC LIMIT 500').all(centerId)
    : db.prepare('SELECT m.*, c.name AS center_name FROM movements m JOIN centers c ON c.id = m.center_id ORDER BY m.created_at DESC LIMIT 500').all();

  return rows.map(r => ({
    id: r.id,
    centerId: r.center_id,
    centerName: r.center_name,
    userId: r.user_id,
    bloodType: r.blood_type,
    type: r.type,
    quantity: r.quantity,
    quantityBefore: r.quantity_before,
    quantityAfter: r.quantity_after,
    note: r.note,
    date: r.created_at
  }));
}

module.exports = { getAll, getById, updateStock, addMovement, getMovements, BLOOD_TYPES };
