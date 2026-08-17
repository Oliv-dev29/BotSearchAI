const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const db = require("../db");
const { signToken } = require("../services/authToken");
const { loginLimiter, registerLimiter } = require("../middleware/authRateLimit");

// POST /api/auth/login
router.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "username et password requis" });
  }

  try {
    const user = db
      .prepare(
        `SELECT u.*, c.name AS center_name
       FROM users u LEFT JOIN centers c ON c.id = u.center_id
       WHERE u.username = ? AND u.is_active = 1`,
      )
      .get(username);

    if (!user)
      return res.status(401).json({ error: "Identifiants incorrects" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: "Identifiants incorrects" });

    res.json({
      token: signToken(user),
      role: user.role,
      centerId: user.center_id,
      centerName: user.center_name,
      username: user.username,
      mustChangePassword: user.must_change_password === 1,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/auth/register
router.post("/register", registerLimiter, async (req, res) => {
  const { username, password, centerId } = req.body;

  if (!username || !password || !centerId) {
    return res
      .status(400)
      .json({ error: "username, password et centerId sont requis" });
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: "Le mot de passe doit faire au moins 8 caractères" });
  }

  try {
    const center = db
      .prepare("SELECT id FROM centers WHERE id = ?")
      .get(centerId);
    if (!center) return res.status(400).json({ error: "Centre introuvable" });

    const existing = db
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(username);
    if (existing)
      return res
        .status(409)
        .json({ error: "Ce nom d'utilisateur est déjà pris" });

    const password_hash = await bcrypt.hash(password, 12);
    const result = db
      .prepare(
        "INSERT INTO users (username, password_hash, role, center_id, is_active, must_change_password) VALUES (?, ?, 'agent', ?, 0, 0)",
      )
      .run(username, password_hash, centerId);

    res.status(201).json({
      message: "Compte créé. En attente de validation par l'administrateur.",
      userId: result.lastInsertRowid,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
