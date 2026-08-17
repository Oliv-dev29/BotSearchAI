require("dotenv").config();

// Refuse de démarrer si JWT_SECRET est absent ou trop faible : un secret
// court/prévisible permettrait de forger des tokens (y compris admin).
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error(
    "Erreur de configuration : JWT_SECRET est manquant ou fait moins de 32 caractères. " +
      "Définissez une valeur forte et aléatoire dans .env avant de démarrer le serveur.",
  );
  process.exit(1);
}

require("./initDb"); // Initialise la base SQLite au démarrage
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");

const authRoute = require("./routes/auth");
const adminRoute = require("./routes/admin");
const chatRoute = require("./routes/chat");
const centerService = require("../services/centerService");
const {
  searchBlood,
  searchBloodWithLocation,
  BLOOD_TYPES,
} = require("../services/bloodLogic");
const {
  addSubscription,
  scheduleCleanup,
} = require("../services/notificationService");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_RATE_LIMIT_WINDOW_MS = parseInt(
  process.env.PUBLIC_RATE_LIMIT_WINDOW_MS || "60000",
  10,
);
const PUBLIC_RATE_LIMIT_SEARCH_MAX = parseInt(
  process.env.PUBLIC_RATE_LIMIT_SEARCH_MAX || "60",
  10,
);
const PUBLIC_RATE_LIMIT_CHAT_MAX = parseInt(
  process.env.PUBLIC_RATE_LIMIT_CHAT_MAX || "30",
  10,
);
const PUBLIC_RATE_LIMIT_SUBSCRIPTIONS_MAX = parseInt(
  process.env.PUBLIC_RATE_LIMIT_SUBSCRIPTIONS_MAX || "20",
  10,
);

function createPublicLimiter(maxRequests) {
  return rateLimit({
    windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de requêtes, veuillez réessayer plus tard." },
  });
}

const searchLimiter = createPublicLimiter(PUBLIC_RATE_LIMIT_SEARCH_MAX);
const chatLimiter = createPublicLimiter(PUBLIC_RATE_LIMIT_CHAT_MAX);
const subscriptionsLimiter = createPublicLimiter(
  PUBLIC_RATE_LIMIT_SUBSCRIPTIONS_MAX,
);

// Origines autorisées depuis ALLOWED_ORIGINS (séparées par des virgules).
// Les appels sans Origin (bot Node.js, curl, serveur-à-serveur) passent toujours.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3001")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS : origine non autorisée (${origin})`));
    },
  }),
);
app.use(express.json());

// Portail admin
app.use("/admin", express.static(path.join(__dirname, "../admin")));

// Portail centre (accès direct des centres sans passer par /admin)
app.use("/center", express.static(path.join(__dirname, "../admin")));

// Rediriger la racine vers /center
app.get("/", (req, res) => res.redirect("/center"));

// API
app.use("/api/auth", authRoute);
app.use("/api/admin", adminRoute);
app.use("/api/chat", chatLimiter, chatRoute);

// GET /api/centers — liste publique des centres
// ?all=true → inclut les centres fermés (ex : commande /centres du bot)
app.get("/api/centers", (req, res) => {
  const centers = centerService.getAll();
  res.json(
    req.query.all === "true" ? centers : centers.filter((c) => c.isOpen),
  );
});

// GET /api/search?bloodType=O+
// GET /api/search?bloodType=O+&lat=6.37&lng=2.42
// Recherche publique sans authentification (utilisée par le bot Telegram/WhatsApp)
app.get("/api/search", searchLimiter, (req, res) => {
  const { bloodType, lat, lng } = req.query;

  if (!bloodType) {
    return res.status(400).json({ error: "Paramètre bloodType requis." });
  }
  if (!BLOOD_TYPES.includes(bloodType)) {
    return res
      .status(400)
      .json({ error: "Groupe sanguin invalide.", validTypes: BLOOD_TYPES });
  }

  const hasLocation = lat !== undefined && lng !== undefined;
  if ((lat === undefined) !== (lng === undefined)) {
    return res
      .status(400)
      .json({ error: "lat et lng doivent être fournis ensemble." });
  }

  if (hasLocation) {
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);
    if (isNaN(userLat) || isNaN(userLng)) {
      return res
        .status(400)
        .json({ error: "lat et lng doivent être des nombres valides." });
    }
    return res.json(searchBloodWithLocation(bloodType, userLat, userLng));
  }

  return res.json(searchBlood(bloodType));
});

// POST /api/subscriptions — enregistre une alerte push pour un groupe sanguin
// Appelé par le bot quand la recherche ne retourne pas de groupe exact.
app.post("/api/subscriptions", subscriptionsLimiter, (req, res) => {
  const { chatId, bloodType } = req.body;

  if (!chatId || !bloodType) {
    return res.status(400).json({ error: "chatId et bloodType sont requis." });
  }
  if (typeof chatId !== "number" || !Number.isInteger(chatId)) {
    return res.status(400).json({ error: "chatId doit être un entier." });
  }
  if (!BLOOD_TYPES.includes(bloodType)) {
    return res.status(400).json({ error: "Groupe sanguin invalide." });
  }

  addSubscription(chatId, bloodType);
  res.json({ ok: true });
});

// Gestionnaire d'erreurs CORS — remplace le 500 par un 403 propre sans stack trace
app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith("CORS")) {
    return res.status(403).json({ error: "Origine non autorisée." });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`SangBenin API démarrée sur le port ${PORT}`);
  console.log(`Dashboard Admin : http://localhost:${PORT}/admin`);
  console.log(`Portail Centre : http://localhost:${PORT}/center`);
  scheduleCleanup();
});
