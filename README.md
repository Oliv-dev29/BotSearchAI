# SangBenin — Documentation complète du projet

## 1) Vue d’ensemble

**SangBenin** est une plateforme de coordination des stocks de sang au Bénin.
Le projet combine :

- une **API backend** (Node.js + Express + SQLite),
- un **dashboard opérationnel** pour l’administration et les agents de centres,
- un **chat web public** pour rechercher du sang,
- un **bot Telegram** pour la recherche rapide et les alertes automatiques,
- une base de données locale SQLite initialisée automatiquement.

Objectif principal : **aider à localiser rapidement un groupe sanguin disponible** (ou un groupe compatible) dans les centres ouverts.

---

## 2) Problème métier résolu

Dans un contexte d’urgence transfusionnelle, il faut :

1. Saisir un groupe sanguin (ex: `O+`, `A-`, `AB+`),
2. Vérifier où il est disponible,
3. Prioriser les centres proches si la position utilisateur est fournie,
4. Proposer des alternatives compatibles si le groupe exact est absent,
5. Prévenir l’utilisateur quand un stock exact revient disponible.

SangBenin automatise ces étapes avec un workflow orienté terrain.

---

## 3) Architecture technique

## 3.1 Stack utilisée

### Backend (racine)
- `Node.js`
- `Express`
- `better-sqlite3` (SQLite local)
- `jsonwebtoken` (JWT)
- `bcryptjs` (hash mot de passe)
- `cors`
- `dotenv`

### Bot
- `grammy` (Telegram Bot API)

### Socle web Next.js (dossier `web/`)
- `Next.js 14`
- `React 18`
- `TailwindCSS`
- `xlsx` (exports Excel côté navigateur)

### Interfaces statiques utilisées en production
- Interface admin statique (`admin/`) en HTML/CSS/JS
- Chat public statique (`frontend/`) en HTML/CSS/JS

> **Source de vérité produit :** `admin/` est l’interface d’administration
> réellement servie et utilisée en production. `web/` est un socle Next.js
> actuellement en pause : il ne doit pas être développé en parallèle de
> `admin/` sans décision explicite, afin d’éviter de dupliquer des écrans ou
> des règles métier.

## 3.2 Composants et rôles

- `backend/server.js` : point d’entrée API, CORS, routes, statiques admin/center, endpoints publics.
- `backend/initDb.js` : création des tables, seed des centres/stocks, création compte admin.
- `services/centerService.js` : lecture/écriture des stocks et mouvements, calcul des alertes.
- `services/bloodLogic.js` : parsing groupe sanguin, logique exact/compatible, logique géolocalisée.
- `services/notificationService.js` : abonnement bot et push Telegram lors de restock.
- `telegram-bot/bot.js` : UX conversationnelle Telegram (commandes, recherche, localisation).
- `admin/dashboard.js` : interface de supervision opérationnelle + exports CSV/Excel.
- `frontend/chat.js` : mini-chat web public branché sur `/api/chat`.
- `web/` : socle Next.js en pause, conservé pour une future migration planifiée.

---

## 4) Structure des dossiers (interprétation fonctionnelle)

- `backend/`
  - `server.js` : API principale
  - `db.js` : connexion SQLite
  - `initDb.js` : schéma + seed + admin bootstrap
  - `routes/`
    - `auth.js` : login/register
    - `admin.js` : endpoints protégés admin/agent
    - `chat.js` : endpoint chatbot public
  - `middleware/auth.js` : vérification JWT
  - `services/geoService.js` : distance Haversine + tri de proximité

- `services/`
  - `bloodLogic.js` : moteur de recherche sanguine
  - `centerService.js` : orchestration centres/stocks/mouvements
  - `notificationService.js` : abonnements & notifications Telegram

- `data/`
  - `compatibility.json` : matrice de compatibilité sanguine
  - `sangbenin.db` : base SQLite générée au runtime

- `admin/`
  - `index.html`, `dashboard.js`, `style.css`
  - Portail d’exploitation principal réellement utilisé en production (admin + agents)

- `frontend/`
  - Chat public simple

- `telegram-bot/`
  - `bot.js` : bot Telegram connecté à l’API

- `web/`
  - socle Next.js en pause ; ne pas y reproduire les fonctionnalités de `admin/`
    sans décision de migration dédiée

## 4.1 Évolutivité : quand migrer SQLite vers PostgreSQL

SQLite en mode WAL convient au lancement tant que les mises à jour de stock
restent peu concurrentes. Le nombre de centres seul n’est pas le facteur
limitant : SQLite n’autorise qu’un seul écrivain à la fois.

Seuils **indicatifs**, à confirmer par les métriques réelles :

- commencer à planifier la migration vers PostgreSQL autour de **50 centres
  actifs** qui mettent leur stock à jour régulièrement ;
- rendre la migration prioritaire dès que des pointes de **5 à 10 écritures
  simultanées** (mouvements ou mises à jour de stock) provoquent des attentes,
  des erreurs `SQLITE_BUSY` ou des reprises manuelles ;
- ne pas repousser PostgreSQL au-delà d’environ **100 centres actifs** ou si
  l’application doit garantir des écritures concurrentes sans interruption.

Ces repères ne sont pas des limites absolues : une faible activité peut
permettre davantage de centres avec SQLite, tandis que quelques centres très
actifs peuvent justifier PostgreSQL plus tôt.

---

## 5) Modèle de données (SQLite)

Le schéma est créé automatiquement au démarrage.

## 5.1 Tables

### `centers`
- Informations centre : nom, zone, téléphone, horaires, coordonnées GPS, statut ouvert/fermé.
- Seuils d’alerte : `threshold_critique` (défaut 3), `threshold_faible` (défaut 6).

### `blood_stock`
- Stock par centre et groupe sanguin.
- Contrainte unique `(center_id, blood_type)`.

### `movements`
- Historique des mouvements de stock.
- Types : `entree`, `sortie`, `perte`.
- Trace avant/après (`quantity_before`, `quantity_after`) + note + utilisateur.

### `users`
- Comptes dashboard.
- Rôles : `admin` ou `agent`.
- `is_active` pour validation par admin.
- `center_id` pour restreindre les agents à leur centre.

### `bot_subscriptions`
- Abonnements Telegram par `chat_id` et groupe sanguin.
- Expiration automatique (`expires_at`, TTL 24h).

## 5.2 Seed initial

Au premier lancement :
- 4 centres sont insérés avec stocks initiaux.
- Le compte `admin` est créé (mot de passe depuis `.env`).

---

## 6) Authentification et rôles

## 6.1 JWT

Le login retourne un JWT contenant :
- `userId`
- `role`
- `centerId`

Durée de vie : **12 heures**.

## 6.2 Rôles

### Admin
- Accès à tous les centres,
- Consultation et pilotage global,
- Activation/désactivation des comptes agents,
- Lecture de tous les mouvements.

### Agent
- Accès strict à son centre (`center_id`),
- Peut modifier le stock de son centre,
- Peut enregistrer des mouvements sur son centre,
- Ne voit pas les autres centres via les endpoints admin protégés.

---

## 7) Fonctionnalités détaillées (par domaine)

## 7.1 Recherche de sang (moteur métier)

Implémentée dans `services/bloodLogic.js`.

### A. Parsing intelligent du groupe sanguin
Le système accepte :
- format direct (`O+`, `AB-`),
- variantes textuelles (`O POSITIF`, `ABNEG`, etc.),
- extraction depuis phrase libre.

### B. Priorité de recherche standard
1. Chercher le **groupe exact** dans les centres ouverts.
2. Sinon chercher des **groupes compatibles** disponibles.
3. Sinon retour `unavailable`.

### C. Recherche avec géolocalisation
Quand `lat/lng` sont fournis :
1. groupe exact dans centres proches (`<= 20 km`),
2. compatible dans centres proches,
3. expansion vers centres plus éloignés (exact puis compatible),
4. sinon indisponible.

---

## 7.2 Gestion opérationnelle des stocks

Implémentée dans `services/centerService.js`.

### A. Calcul du niveau de stock
Par groupe sanguin :
- `rupture` si quantité = 0
- `critique` si quantité ≤ seuil critique
- `faible` si quantité ≤ seuil faible
- `stable` sinon

### B. Alertes automatiques
Pour chaque centre, le service génère des alertes :
- rupture de groupe,
- stock critique.

### C. Mise à jour de stock directe
`updateStock(centerId, stockUpdates, isOpen)` :
- upsert des quantités,
- mise à jour du statut ouvert/fermé,
- mise à jour timestamp,
- déclenchement asynchrone des notifications restock.

### D. Journalisation des mouvements
`addMovement(...)` :
- calcule nouveau stock depuis l’ancien,
- enregistre le mouvement (avant/après, type, note, user),
- déclenche notification restock si passage de 0 à >0.

---

## 7.3 Notifications Telegram automatiques

Implémentées dans `services/notificationService.js`.

### Comportement
- Un utilisateur peut être abonné à un groupe (`chatId + bloodType`).
- Abonnement valable 24h (renouvelable silencieusement).
- Nettoyage périodique des abonnements expirés (toutes les heures).

### Déclencheur
Lorsqu’un groupe passe de `0` à `>0` :
- récupération des abonnés actifs,
- envoi d’un message Telegram MarkdownV2,
- suppression des abonnements envoyés avec succès (ou bloqués 400/403).

Résultat : l’utilisateur est notifié dès qu’un stock exact revient.

---

## 7.4 Bot Telegram (expérience conversationnelle)

Implémenté dans `telegram-bot/bot.js`.

### Commandes
- `/start` : introduction + exemples
- `/aide` : explication du workflow exact/compatible/proximité
- `/centres` : liste centres ouverts et fermés

### Flux principal utilisateur
1. L’utilisateur envoie un groupe sanguin.
2. Le bot appelle `/api/search`.
3. Si exact trouvé : retour des centres + proposition de partager la position.
4. Si compatible seulement : retour compatible + abonnement silencieux sur le groupe exact.
5. Si indisponible : message d’urgence + abonnement silencieux.

### Gestion de localisation Telegram
- Si groupe connu en session : relance recherche géolocalisée (`/api/search?lat&lng`).
- Sinon : affiche les 5 centres ouverts les plus proches (distance locale Haversine).

### Session mémoire côté bot
- Conservation temporaire du dernier groupe demandé (TTL 10 minutes).

---

## 7.5 Chat web public (`frontend/`)

### Fonctionnalités
- UI de chat simple pour saisir un groupe.
- Géolocalisation navigateur tentée automatiquement.
- Appel `POST /api/chat` avec message + localisation (si disponible).
- Affichage :
  - inconnu (`unknown`) → aide format,
  - trouvé (`found`) → cartes centres + liens Google Maps,
  - indisponible (`unavailable`) → bloc urgence.

### Usage
- Convient à un accès web rapide sans Telegram.

---

## 7.6 Dashboard admin/centre (`admin/`)

Portail principal d’exploitation avec un mode admin global et un mode centre (`/center`).

### A. Auth et onboarding
- Login via `/api/auth/login`.
- Register agent via `/api/auth/register` (compte inactif jusqu’à validation admin).
- Séparation stricte des portails :
  - admin sur `/admin`,
  - agent sur `/center`.

### B. Vue d’ensemble
- KPI : centres total, ouverts, fermés, alertes, stocks critiques.
- Monitoring des stocks par centre et groupe.
- Indication de fraîcheur des données (`STALE_HOURS = 4`).

### C. Alertes
- Bannière alertes en cours.
- Tableau d’alertes prioritaires (rupture, critique, infos données obsolètes).

### D. Analyses et insights
- Top groupes les plus sollicités.
- Top centres les plus actifs.
- Tendance 7 jours vs 7 jours précédents.
- Courbe de consommation + histogramme de stock.

### E. Mouvements
- Enregistrement mouvement via modal (`entree/sortie/perte`).
- Historique filtrable (centre, type, groupe).
- Traçabilité avant/après.

### F. Gestion de stock
- Modification complète du stock par groupe.
- Toggle centre ouvert/fermé.

### G. Exports institutionnels
- Export CSV complet multi-sections.
- Export Excel (`xlsx`) avec feuilles : résumé, alertes, insights, recommandations, consommation, stocks.

---

## 7.7 API REST — endpoints exposés

## Public
- `GET /api/centers` : centres ouverts (ou `?all=true` pour tout)
- `GET /api/search?bloodType=...` (+ option `lat/lng`)
- `POST /api/chat` : moteur chat web
- `POST /api/subscriptions` : abonnement notification (chatId + bloodType)
- `POST /api/auth/login`
- `POST /api/auth/register`

## Protégés (`Bearer JWT`)
- `GET /api/admin/me`
- `GET /api/admin/centers`
- `GET /api/admin/centers/:id`
- `PATCH /api/admin/centers/:id/stock`
- `POST /api/admin/centers/:id/movement`
- `GET /api/admin/movements`
- `GET /api/admin/alerts`
- `GET /api/admin/users` (admin)
- `PATCH /api/admin/users/:id/activate` (admin)

---

## 8) Sécurité et garde-fous

- CORS strict basé sur `ALLOWED_ORIGINS`.
- JWT obligatoire sur routes admin.
- Contrôle d’accès par rôle et `center_id`.
- Mots de passe hashés (`bcrypt`, coût 12).
- Données sensibles via `.env`.

---

## 9) Configuration `.env`

Créer un fichier `.env` à la racine :

```env
PORT=3000
JWT_SECRET=change_me_super_secret
ADMIN_PASSWORD=change_me_admin_password
ALLOWED_ORIGINS=http://localhost:3001
TELEGRAM_BOT_TOKEN=123456:telegram_token
API_URL=http://localhost:3000
NEARBY_KM=20
PUBLIC_RATE_LIMIT_WINDOW_MS=60000
PUBLIC_RATE_LIMIT_SEARCH_MAX=60
PUBLIC_RATE_LIMIT_CHAT_MAX=30
PUBLIC_RATE_LIMIT_SUBSCRIPTIONS_MAX=20
```

### Variables importantes
- `PORT` : port API Express
- `JWT_SECRET` : signature JWT
- `ADMIN_PASSWORD` : mot de passe du compte admin initial
- `ALLOWED_ORIGINS` : origines web autorisées (séparées par virgules)
- `TELEGRAM_BOT_TOKEN` : token bot Telegram
- `API_URL` : URL API consommée par le bot
- `NEARBY_KM` : rayon de proximité en km pour la recherche géolocalisée (défaut 20)
- `PUBLIC_RATE_LIMIT_WINDOW_MS` : fenêtre du rate limiting public en millisecondes
- `PUBLIC_RATE_LIMIT_SEARCH_MAX` : max requêtes/IP par fenêtre sur `/api/search`
- `PUBLIC_RATE_LIMIT_CHAT_MAX` : max requêtes/IP par fenêtre sur `/api/chat`
- `PUBLIC_RATE_LIMIT_SUBSCRIPTIONS_MAX` : max requêtes/IP par fenêtre sur `/api/subscriptions`

---

## 10) Installation et lancement

## 10.1 Prérequis
- Node.js **18+** recommandé (utilisation de `fetch` natif côté Node)
- npm

## 10.2 Installation

À la racine :

```bash
npm install
```

Pour l’app Next.js :

```bash
cd web
npm install
cd ..
```

## 10.3 Lancement API

```bash
npm run dev
```

- API : `http://localhost:3000`
- Dashboard Admin statique : `http://localhost:3000/admin`
- Portail Centre : `http://localhost:3000/center`
- Racine `/` redirige vers `/center`

## 10.4 Lancement bot Telegram

```bash
npm run dev:bot
```

## 10.5 Lancement app Next.js

```bash
npm run web
```

- Next.js sur `http://localhost:3001`

---

## 11) Scripts disponibles

Depuis `package.json` racine :

- `npm start` : lance l’API
- `npm run dev` : API avec nodemon
- `npm run bot` : lance bot Telegram
- `npm run dev:bot` : bot avec nodemon
- `npm run web` : lance le frontend Next.js
- `npm test` : exécute les tests unitaires Node

---

## 12) Comportements importants à connaître

1. **Initialisation bloquante** : si `ADMIN_PASSWORD` absent au premier lancement, le process s’arrête.
2. **Persistance locale** : SQLite dans `data/sangbenin.db`.
3. **Centres fermés exclus** des recherches publiques standard.
4. **Abonnements Telegram auto-nettoyés** après notification réussie ou expiration.
5. **Portail `/center` réservé agents** ; un admin y est refusé.
6. **Portail `/admin` réservé admin** ; un agent est redirigé vers `/center`.

---

## 13) État actuel du dossier `web/` (Next.js)

Le socle Next.js est présent (layout, login, hooks d’auth et de refresh) mais :

- les pages sources `web/app/admin` et `web/app/center` sont actuellement vides,
- l’interface opérationnelle complète est, à ce stade, dans le dossier `admin/` (HTML/JS statique).

Cela signifie que le projet tourne réellement aujourd’hui avec :
- **API backend + dashboard statique + bot Telegram + chat public**,
- et un frontend Next.js amorcé pour migration/modernisation.

### Note scalabilité SQLite

SQLite convient très bien pour le volume actuel (quelques centres, écritures modérées, faible concurrence). En pratique, il faut planifier une migration Postgres quand on approche d’un contexte multi-régions avec de nombreuses écritures simultanées (ordre de grandeur : **plusieurs dizaines de centres actifs avec flux quasi temps réel et contention fréquente en écriture**), ou dès qu’un besoin fort de haute disponibilité/réplication apparaît.

---

## 14) Cas d’usage typiques

### Cas 1 — Patient/urgentiste via Telegram
1. Envoie `O+`.
2. Reçoit centres disponibles (ou compatibles).
3. Partage sa position pour tri distance.
4. Reçoit alerte plus tard si `O+` revient en stock.

### Cas 2 — Agent centre
1. Se connecte sur `/center`.
2. Modifie stock ou enregistre mouvement.
3. Les alertes/KPI se mettent à jour immédiatement.
4. Un restock peut déclencher des notifications Telegram abonnés.

### Cas 3 — Supervision admin
1. Se connecte sur `/admin`.
2. Visualise état national (KPI, alertes, tendances).
3. Exporte rapport CSV/Excel pour partage institutionnel.

---

## 15) Résumé exécutif

SangBenin est une solution opérationnelle complète qui relie :

- **données terrain des centres**,
- **moteur métier de compatibilité sanguine**,
- **canaux utilisateurs (web + Telegram)**,
- **surveillance et pilotage administratif**,
- **notifications automatiques sur restock critique**.

Le cœur du système est déjà fonctionnel et exploitable en production locale, avec un axe d’évolution naturel vers la consolidation complète du frontend Next.js.
