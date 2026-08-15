const jwt = require("jsonwebtoken");
const db = require("../db");

function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token manquant" });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db
      .prepare(
        `SELECT u.id, u.username, u.role, u.center_id, u.is_active, u.must_change_password,
              c.name AS center_name
       FROM users u
       LEFT JOIN centers c ON c.id = u.center_id
       WHERE u.id = ?`,
      )
      .get(payload.userId);

    if (!user || user.is_active !== 1) {
      return res.status(401).json({ error: "Token invalide ou expiré" });
    }

    req.userId = user.id;
    req.username = user.username;
    req.role = user.role; // 'admin' | 'agent'
    req.centerId = user.center_id; // null si admin
    req.mustChangePassword = user.must_change_password === 1;
    req.centerName = user.center_name;
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Token invalide ou expiré" });
  }
}

function requirePasswordChangeCompleted(req, res, next) {
  if (req.mustChangePassword) {
    return res.status(403).json({
      error: "Le mot de passe doit être changé avant de continuer.",
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  }

  next();
}

module.exports = { requireAuth, requirePasswordChangeCompleted };
