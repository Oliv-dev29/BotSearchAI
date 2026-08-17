const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");

// Limiteur strict dédié aux routes sensibles (login, register, changement de mot de passe).
// Clé = IP + identifiant (username ou userId), pas seulement l'IP, pour éviter qu'un
// attaquant distribué sur plusieurs IP contre un seul compte ne soit pas ralenti.
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 8;

function createAuthLimiter(identifierFn) {
  return rateLimit({
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    max: AUTH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const identifier = identifierFn(req) || "unknown";
      return `${ipKeyGenerator(req.ip)}:${identifier}`;
    },
    message: {
      error: "Trop de tentatives. Veuillez réessayer dans 15 minutes.",
    },
  });
}

const loginLimiter = createAuthLimiter((req) => req.body?.username);
const registerLimiter = createAuthLimiter((req) => req.body?.username);
const changePasswordLimiter = createAuthLimiter((req) => req.userId);

module.exports = { loginLimiter, registerLimiter, changePasswordLimiter };
