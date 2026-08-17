const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const centerService = require('../../services/centerService');
const {
  requireAuth,
  requirePasswordChangeCompleted,
} = require('../middleware/auth');
const { signToken } = require('../services/authToken');
const { changePasswordLimiter } = require('../middleware/authRateLimit');

router.use(requireAuth);

// POST /api/admin/change-password
// Accessible uniquement avec un JWT valide, avant le garde obligatoire.
router.post('/change-password', changePasswordLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (typeof currentPassword !== 'string' || !currentPassword) {
    return res.status(400).json({ error: 'currentPassword requis' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 12) {
    return res.status(400).json({
      error: 'Le nouveau mot de passe doit faire au moins 12 caractères',
    });
  }

  try {
    const user = db
      .prepare(
        `SELECT u.*, c.name AS center_name
         FROM users u
         LEFT JOIN centers c ON c.id = u.center_id
         WHERE u.id = ?`,
      )
      .get(req.userId);

    const currentPasswordMatches = await bcrypt.compare(
      currentPassword,
      user.password_hash,
    );
    if (!currentPasswordMatches) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }

    const newPasswordMatchesCurrent = await bcrypt.compare(
      newPassword,
      user.password_hash,
    );
    if (newPasswordMatchesCurrent) {
      return res.status(400).json({
        error: 'Le nouveau mot de passe doit être différent de l’actuel',
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    db.prepare(
      'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
    ).run(passwordHash, req.userId);

    const updatedUser = {
      ...user,
      password_hash: passwordHash,
      must_change_password: 0,
    };

    return res.json({
      token: signToken(updatedUser),
      role: updatedUser.role,
      centerId: updatedUser.center_id,
      centerName: updatedUser.center_name,
      username: updatedUser.username,
      mustChangePassword: false,
      message: 'Mot de passe mis à jour avec succès.',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Toutes les autres routes admin sont bloquées jusqu'au changement obligatoire.
router.use(requirePasswordChangeCompleted);

function canAccessCenter(req, res, centerId) {
  if (req.role === 'admin') return true;
  if (req.centerId !== centerId) {
    res.status(403).json({ error: 'Accès refusé à ce centre' });
    return false;
  }
  return true;
}

// GET /api/admin/me
router.get('/me', (req, res) => {
  if (req.role === 'admin') return res.json({ role: 'admin', centerId: null, centerName: null });
  const center = centerService.getById(req.centerId);
  res.json({ role: 'agent', centerId: req.centerId, centerName: center?.name || null });
});

// GET /api/admin/centers
router.get('/centers', (req, res) => {
  const all = centerService.getAll();
  if (req.role === 'admin') return res.json(all);
  const center = all.find(c => c.id === req.centerId);
  res.json(center ? [center] : []);
});

// GET /api/admin/centers/:id
router.get('/centers/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!canAccessCenter(req, res, id)) return;
  const center = centerService.getById(id);
  if (!center) return res.status(404).json({ error: 'Centre non trouvé' });
  res.json(center);
});

// PATCH /api/admin/centers/:id/stock
router.patch('/centers/:id/stock', (req, res) => {
  const id = parseInt(req.params.id);
  if (!canAccessCenter(req, res, id)) return;
  const { stock, isOpen } = req.body;
  if (!stock || typeof stock !== 'object') {
    return res.status(400).json({ error: 'stock doit être un objet { "O+": quantité, ... }' });
  }
  const updated = centerService.updateStock(id, stock, isOpen);
  if (!updated) return res.status(404).json({ error: 'Centre non trouvé' });
  res.json(updated);
});

// POST /api/admin/centers/:id/movement
router.post('/centers/:id/movement', (req, res) => {
  const id = parseInt(req.params.id);
  if (!canAccessCenter(req, res, id)) return;
  const { type, bloodType, quantity, note } = req.body;
  if (!['entree', 'sortie', 'perte'].includes(type)) {
    return res.status(400).json({ error: 'type doit être entree, sortie ou perte' });
  }
  if (!bloodType || typeof quantity !== 'number' || quantity <= 0) {
    return res.status(400).json({ error: 'bloodType et quantity (>0) sont requis' });
  }
  const result = centerService.addMovement(id, type, bloodType, quantity, note, req.userId);
  if (!result) return res.status(404).json({ error: 'Centre non trouvé' });
  res.json(result);
});

// GET /api/admin/movements
router.get('/movements', (req, res) => {
  let centerId = req.query.centerId ? parseInt(req.query.centerId) : null;
  if (req.role === 'agent') centerId = req.centerId;
  res.json(centerService.getMovements(centerId));
});

// GET /api/admin/alerts
router.get('/alerts', (req, res) => {
  const centers = req.role === 'admin'
    ? centerService.getAll()
    : [centerService.getById(req.centerId)].filter(Boolean);
  res.json(
    centers
      .filter(c => c.alerts.length > 0)
      .map(c => ({ id: c.id, name: c.name, quartier: c.quartier, alerts: c.alerts }))
  );
});

// GET /api/admin/users (admin uniquement)
router.get('/users', (req, res) => {
  if (req.role !== 'admin') return res.status(403).json({ error: "Réservé à l'admin" });
  const rows = db.prepare(
    `SELECT u.id, u.username, u.role, u.is_active, u.created_at, c.name AS center_name
     FROM users u LEFT JOIN centers c ON c.id = u.center_id ORDER BY u.created_at DESC`
  ).all();
  res.json(rows);
});

// PATCH /api/admin/users/:id/activate (admin uniquement)
router.patch('/users/:id/activate', (req, res) => {
  if (req.role !== 'admin') return res.status(403).json({ error: "Réservé à l'admin" });
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(req.body.is_active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
