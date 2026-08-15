const BLOOD_TYPES = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"];
const STALE_HOURS = 4;
const INSIGHT_WINDOW_DAYS = 30;
const IS_CENTER_PORTAL = window.location.pathname.startsWith("/center");
const DEFAULT_PORTAL_TITLE = IS_CENTER_PORTAL
  ? "SangBenin Centre"
  : "SangBenin Admin";

let authToken = null;
let userRole = null; // 'admin' | 'agent'
let userCenterId = null; // null si admin
let centers = [];
let movements = [];
let editingCenterId = null;
let movementCenterId = null;

initializePortalUI();

// ─── AUTH ─────────────────────────────────────────────────────────────────────

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = document.getElementById("password-input").value;
  const errorEl = document.getElementById("login-error");
  errorEl.style.display = "none";

  try {
    // Login → récupère un JWT
    const loginRes = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("username-input").value,
        password,
      }),
    });
    if (!loginRes.ok) throw new Error();
    const me = await loginRes.json();

    if (IS_CENTER_PORTAL && me.role !== "agent") {
      errorEl.style.display = "block";
      errorEl.textContent =
        "Ce compte doit se connecter via le portail Admin (/admin).";
      return;
    }

    if (!IS_CENTER_PORTAL && me.role !== "admin") {
      window.location.href = "/center";
      return;
    }

    setAuthenticatedUser(me);

    if (me.mustChangePassword) {
      showPasswordChangeScreen();
      return;
    }

    await openDashboard(me);
  } catch {
    errorEl.style.display = "block";
    errorEl.textContent = "Mot de passe incorrect.";
  }
});

function setAuthenticatedUser(user) {
  authToken = user.token;
  userRole = user.role;
  userCenterId = user.centerId;
}

function showPasswordChangeScreen() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("register-screen").style.display = "none";
  document.getElementById("password-change-screen").hidden = false;
  document.getElementById("current-password-input").focus();
}

async function openDashboard(user) {

  // Chargement des centres
  const centersRes = await fetch("/api/admin/centers", {
    headers: { Authorization: "Bearer " + authToken },
  });
  if (!centersRes.ok) throw new Error("Impossible de charger les centres");
  centers = await centersRes.json();

  document.getElementById("password-change-screen").hidden = true;
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("dashboard").style.display = "block";

  // Adapter le titre selon le rôle
  if (userRole === "agent") {
    document.querySelector(".topbar-left h1").textContent = user.centerName;
  } else {
    document.querySelector(".topbar-left h1").textContent =
      DEFAULT_PORTAL_TITLE;
  }

  await loadMovements();
  renderOverview();
  populateCenterFilter();
}

document
  .getElementById("password-change-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("password-change-error");
    const currentPassword = document.getElementById("current-password-input").value;
    const newPassword = document.getElementById("new-password-input").value;
    const confirmation = document.getElementById("confirm-password-input").value;
    errorEl.style.display = "none";

    if (newPassword !== confirmation) {
      errorEl.textContent = "La confirmation ne correspond pas au nouveau mot de passe.";
      errorEl.style.display = "block";
      return;
    }

    try {
      const response = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + authToken,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setAuthenticatedUser(data);
      document.getElementById("password-change-form").reset();
      await openDashboard(data);
    } catch (err) {
      errorEl.textContent = err.message || "Impossible de changer le mot de passe.";
      errorEl.style.display = "block";
    }
  });

// ─── REGISTER ─────────────────────────────────────────────────────────────────

document
  .getElementById("show-register")
  .addEventListener("click", async (e) => {
    e.preventDefault();
    document.getElementById("login-screen").style.display = "none";
    document.getElementById("register-screen").style.display = "flex";

    // Charger la liste des centres pour le select
    const res = await fetch("/api/centers");
    const centers = await res.json();
    const sel = document.getElementById("reg-center");
    centers.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
  });

document.getElementById("show-login").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("register-screen").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
});

document
  .getElementById("register-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const fb = document.getElementById("register-feedback");
    fb.style.display = "none";

    const username = document.getElementById("reg-username").value;
    const password = document.getElementById("reg-password").value;
    const centerId = parseInt(document.getElementById("reg-center").value);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, centerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      fb.style.display = "block";
      fb.style.color = "#27ae60";
      fb.textContent = data.message;
      document.getElementById("register-form").reset();
    } catch (err) {
      fb.style.display = "block";
      fb.style.color = "#c0392b";
      fb.textContent = err.message || "Erreur lors de l'inscription.";
    }
  });

// ─── LOGOUT ───────────────────────────────────────────────────────────────────

document.getElementById("logout-btn").addEventListener("click", () => {
  authToken = null;
  userRole = null;
  userCenterId = null;
  centers = [];
  movements = [];
  document.querySelector(".topbar-left h1").textContent = DEFAULT_PORTAL_TITLE;
  document.getElementById("password-change-screen").hidden = true;
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("password-input").value = "";
});

function initializePortalUI() {
  document.title = IS_CENTER_PORTAL
    ? "SangBenin — Portail Centre"
    : "SangBenin — Dashboard Admin";

  const loginTitle = document.querySelector("#login-screen .login-box h1");
  const loginSubtitle = document.querySelector("#login-screen .login-box p");
  const topbarTitle = document.querySelector(".topbar-left h1");

  if (loginTitle) loginTitle.textContent = DEFAULT_PORTAL_TITLE;
  if (topbarTitle) topbarTitle.textContent = DEFAULT_PORTAL_TITLE;

  if (IS_CENTER_PORTAL) {
    if (loginSubtitle) {
      loginSubtitle.textContent =
        "Connexion réservée au personnel des centres de transfusion";
    }

    const registerLink = document.getElementById("show-register");
    const registerParagraph = registerLink?.closest(".register-link");
    if (registerParagraph) registerParagraph.style.display = "none";
  }
}

// ─── TABS ─────────────────────────────────────────────────────────────────────

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.remove("active"));
    document
      .querySelectorAll(".tab-content")
      .forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "movements") renderMovementsTable();
  });
});

const chartPeriodFilter = document.getElementById("chart-period-filter");
if (chartPeriodFilter) {
  chartPeriodFilter.addEventListener("change", () => {
    renderDataCharts();
  });
}

attachExportActions();

// ─── DONNÉES ──────────────────────────────────────────────────────────────────

async function reloadCenters() {
  const res = await fetch("/api/admin/centers", {
    headers: { Authorization: "Bearer " + authToken },
  });
  centers = await res.json();
}

async function loadMovements() {
  const res = await fetch("/api/admin/movements", {
    headers: { Authorization: "Bearer " + authToken },
  });
  movements = await res.json();
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function isStale(lastUpdated) {
  const diff = (Date.now() - new Date(lastUpdated).getTime()) / 3600000;
  return diff > STALE_HOURS;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function levelLabel(level) {
  const labels = {
    stable: "Stable",
    faible: "Faible",
    critique: "Critique",
    rupture: "Rupture",
  };
  return labels[level] || level;
}

function getMovementDate(movement) {
  return new Date(
    movement.date || movement.created_at || movement.createdAt || 0,
  );
}

function getSelectedChartPeriod() {
  const el = document.getElementById("chart-period-filter");
  const value = el ? parseInt(el.value, 10) : 14;
  return Number.isFinite(value) && value > 0 ? value : 14;
}

function formatRelativeAge(iso) {
  const diffMinutes = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60000),
  );
  if (diffMinutes < 60) return `${diffMinutes} min`;
  const hours = Math.round(diffMinutes / 60);
  if (hours < 48) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} j`;
}

function formatDayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function getLastNDaysSeries(days, seedValue = 0) {
  const series = [];
  const labels = [];
  const map = new Map();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = formatDayKey(d);
    map.set(key, seedValue);
    series.push({ key, value: seedValue, date: d });
    labels.push(d);
  }

  return { series, labels, map };
}

function buildLineChartSVG(points, width = 700, height = 240) {
  const padding = 24;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  const safePoints = points.length ? points : [0];
  const max = Math.max(1, ...safePoints);
  const stepX =
    safePoints.length > 1 ? innerWidth / (safePoints.length - 1) : innerWidth;

  const coords = safePoints.map((value, index) => {
    const x = padding + index * stepX;
    const y = padding + innerHeight - (value / max) * innerHeight;
    return { x, y, value };
  });

  const linePath = coords
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
  const areaPath = `${linePath} L ${padding + innerWidth} ${padding + innerHeight} L ${padding} ${padding + innerHeight} Z`;

  return `
    <svg viewBox="0 0 ${width} ${height}" class="mini-chart-svg" role="img" aria-label="Courbe de consommation">
      <defs>
        <linearGradient id="consumptionArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#c0392b" stop-opacity="0.28" />
          <stop offset="100%" stop-color="#c0392b" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <line x1="${padding}" y1="${padding + innerHeight}" x2="${padding + innerWidth}" y2="${padding + innerHeight}" class="chart-axis" />
      <path d="${areaPath}" fill="url(#consumptionArea)" />
      <path d="${linePath}" fill="none" stroke="#c0392b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      ${coords.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3.2" fill="#c0392b" />`).join("")}
    </svg>`;
}

function buildBarChartHTML(items, emptyLabel) {
  if (!items.length) {
    return `<div class="chart-empty">${emptyLabel}</div>`;
  }

  const max = Math.max(1, ...items.map((item) => item.value));
  return `
    <div class="bar-chart">
      ${items
        .map(
          (item) => `
        <div class="bar-item">
          <div class="bar-value">${item.value}</div>
          <div class="bar-track"><span style="height:${Math.max(8, (item.value / max) * 100)}%"></span></div>
          <div class="bar-label">${item.label}</div>
        </div>`,
        )
        .join("")}
    </div>`;
}

function getConsumptionDataset(days) {
  const { series } = getLastNDaysSeries(days, 0);
  const consumptionMap = new Map(series.map((item) => [item.key, 0]));

  for (const m of movements) {
    const d = getMovementDate(m);
    if (!Number.isFinite(d.getTime())) continue;
    const key = formatDayKey(d);
    if (!consumptionMap.has(key)) continue;
    if (m.type === "sortie" || m.type === "perte") {
      consumptionMap.set(
        key,
        consumptionMap.get(key) + (Number(m.quantity) || 0),
      );
    }
  }

  const labels = series.map((item) => {
    const d = new Date(item.key + "T00:00:00");
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  });

  const values = series.map((item) => consumptionMap.get(item.key) || 0);
  const lastSeven = values.slice(-7).reduce((sum, v) => sum + v, 0);
  const prevSeven = values.slice(0, 7).reduce((sum, v) => sum + v, 0);

  return { days, series, labels, values, lastSeven, prevSeven };
}

function getStockDataset() {
  return centers
    .slice()
    .sort((a, b) => {
      const totalA = BLOOD_TYPES.reduce(
        (sum, t) =>
          sum + ((a.stock && a.stock[t] ? a.stock[t].quantity : 0) || 0),
        0,
      );
      const totalB = BLOOD_TYPES.reduce(
        (sum, t) =>
          sum + ((b.stock && b.stock[t] ? b.stock[t].quantity : 0) || 0),
        0,
      );
      return totalB - totalA;
    })
    .map((center) => {
      const totalStock = BLOOD_TYPES.reduce(
        (sum, t) =>
          sum +
          ((center.stock && center.stock[t] ? center.stock[t].quantity : 0) ||
            0),
        0,
      );
      const criticalCount = center.alerts
        ? center.alerts.filter(
            (a) => a.level === "critique" || a.level === "rupture",
          ).length
        : 0;
      return {
        id: center.id,
        name: center.name,
        zone: center.zone,
        quartier: center.quartier,
        totalStock,
        isOpen: center.isOpen,
        alertsCount: center.alerts ? center.alerts.length : 0,
        criticalCount,
        updatedAt: center.lastUpdated,
      };
    });
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return "N/A";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function buildRecommendations(report) {
  const recommendations = [];

  if (report.insights.criticalCenters.length > 0) {
    recommendations.push(
      `Prioriser l'approvisionnement des ${report.insights.criticalCenters.length} centre(s) en tension critique ou rupture.`,
    );
  }

  if (report.insights.staleCenters.length > 0) {
    recommendations.push(
      `Mettre à jour les stocks de ${report.insights.staleCenters.length} centre(s) afin de fiabiliser la lecture opérationnelle.`,
    );
  }

  if (report.insights.delta != null) {
    if (report.insights.delta > 10) {
      recommendations.push(
        "Renforcer les campagnes de don sur la période étudiée, la consommation progresse nettement.",
      );
    } else if (report.insights.delta < -10) {
      recommendations.push(
        "Vérifier la baisse des mouvements et consolider la disponibilité des données de terrain.",
      );
    }
  }

  if (report.insights.topCenters.length > 0) {
    const topCenter = report.insights.topCenters[0].center.name;
    recommendations.push(
      `Suivre de près le centre le plus actif (${topCenter}) pour anticiper les besoins récurrents.`,
    );
  }

  if (report.insights.topBloods.length > 0) {
    recommendations.push(
      `Cibler les campagnes de collecte sur le groupe ${report.insights.topBloods[0].bloodType}, actuellement le plus sollicité.`,
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Situation stable : maintenir la surveillance et poursuivre la mise à jour régulière des stocks.",
    );
  }

  return recommendations;
}

function buildExportRows() {
  const periodDays = getSelectedChartPeriod();
  const consumption = getConsumptionDataset(periodDays);
  const insights = getInsightData();
  const priorityAlerts = getPriorityAlerts();
  const stock = getStockDataset();
  const recommendations = buildRecommendations({
    insights,
    stock,
    consumption,
  });

  const summaryRows = [
    {
      section: "summary",
      metric: "exported_at",
      value: new Date().toISOString(),
      details: "Rapport généré depuis SangBenin Admin",
    },
    {
      section: "summary",
      metric: "period_days",
      value: periodDays,
      details: "Période sélectionnée pour la courbe de consommation",
    },
    {
      section: "summary",
      metric: "centers_total",
      value: centers.length,
      details: "Nombre total de centres",
    },
    {
      section: "summary",
      metric: "centers_open",
      value: centers.filter((c) => c.isOpen).length,
      details: "Centres ouverts",
    },
    {
      section: "summary",
      metric: "alerts_active",
      value: centers.filter((c) => c.alerts && c.alerts.length > 0).length,
      details: "Centres avec alertes",
    },
    {
      section: "summary",
      metric: "critical_centers",
      value: insights.criticalCenters.length,
      details: "Centres en tension critique ou rupture",
    },
    {
      section: "summary",
      metric: "stale_centers",
      value: insights.staleCenters.length,
      details: "Centres dont les données sont anciennes",
    },
    {
      section: "summary",
      metric: "movements_total",
      value: movements.length,
      details: "Total des mouvements enregistrés",
    },
    {
      section: "summary",
      metric: "open_rate",
      value: `${Math.round((centers.filter((c) => c.isOpen).length / Math.max(1, centers.length)) * 100)}%`,
      details: "Taux de centres ouverts",
    },
  ];

  const alertRows = priorityAlerts.map((alert) => ({
    section: "alert",
    level: alert.level,
    center: alert.centerName,
    message: alert.message,
    age: alert.age,
  }));

  const insightRows = [
    ...insights.topBloods.map((item, index) => ({
      section: "insight",
      metric: "top_blood",
      rank: index + 1,
      label: item.bloodType,
      value: item.score,
    })),
    ...insights.topCenters.map((item, index) => ({
      section: "insight",
      metric: "top_center",
      rank: index + 1,
      label: item.center.name,
      zone: item.center.zone,
      value: item.score,
    })),
    {
      section: "insight",
      metric: "trend_7d",
      value: formatPercent(insights.delta),
      details: "Variation de la consommation sur 7 jours vs période précédente",
    },
    {
      section: "insight",
      metric: "movements_last_7d",
      value: insights.last7Total,
      details: "Volume des mouvements sur les 7 derniers jours",
    },
    {
      section: "insight",
      metric: "movements_prev_7d",
      value: insights.prev7Total,
      details: "Volume des mouvements sur les 7 jours précédents",
    },
  ];

  const recommendationRows = recommendations.map((item, index) => ({
    section: "recommendation",
    rank: index + 1,
    label: item,
  }));

  const executiveRows = [
    {
      section: "executive",
      label: "Titre",
      value: "Rapport institutionnel SangBenin",
    },
    {
      section: "executive",
      label: "Date d'export",
      value: new Date().toISOString(),
    },
    {
      section: "executive",
      label: "Période analysée",
      value: `${periodDays} jours`,
    },
    {
      section: "executive",
      label: "Centres total",
      value: centers.length,
    },
    {
      section: "executive",
      label: "Centres ouverts",
      value: centers.filter((c) => c.isOpen).length,
    },
    {
      section: "executive",
      label: "Centres critiques",
      value: insights.criticalCenters.length,
    },
    {
      section: "executive",
      label: "Centres obsolètes",
      value: insights.staleCenters.length,
    },
    {
      section: "executive",
      label: "Mouvements enregistrés",
      value: movements.length,
    },
    {
      section: "executive",
      label: "Tendance 7j",
      value: formatPercent(insights.delta),
    },
    {
      section: "executive",
      label: "Top groupe sollicité",
      value: insights.topBloods[0]
        ? `${insights.topBloods[0].bloodType} (${insights.topBloods[0].score})`
        : "N/A",
    },
    {
      section: "executive",
      label: "Centre le plus actif",
      value: insights.topCenters[0]
        ? `${insights.topCenters[0].center.name} (${insights.topCenters[0].score})`
        : "N/A",
    },
  ];

  const consumptionRows = consumption.series.map((item, index) => ({
    section: "consumption",
    date: item.key,
    label: consumption.labels[index],
    value: consumption.values[index],
  }));

  const stockRows = stock.map((center) => ({
    section: "stock",
    center: center.name,
    zone: center.zone,
    quartier: center.quartier,
    status: center.isOpen ? "ouvert" : "fermé",
    total_stock: center.totalStock,
    alerts: center.alertsCount,
    critical_alerts: center.criticalCount,
    updated_at: center.updatedAt,
  }));

  return {
    periodDays,
    executiveRows,
    summaryRows,
    alertRows,
    insightRows,
    recommendationRows,
    consumptionRows,
    stockRows,
    insights,
  };
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value) {
  if (value == null) return "";
  const str = String(value).replace(/\r?\n/g, " ");
  if (/[";,]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toCsv(rows) {
  const columns = [
    "section",
    "label",
    "metric",
    "rank",
    "center",
    "zone",
    "quartier",
    "status",
    "level",
    "message",
    "age",
    "date",
    "value",
    "details",
    "alerts",
    "critical_alerts",
    "updated_at",
  ];

  const header = columns.join(";");
  const lines = rows.map((row) =>
    columns.map((col) => csvEscape(row[col])).join(";"),
  );
  return "\ufeff" + [header, ...lines].join("\n");
}

function exportCsvReport() {
  const report = buildExportRows();
  const rows = [
    ...report.executiveRows,
    ...report.summaryRows,
    ...report.alertRows,
    ...report.insightRows,
    ...report.recommendationRows,
    ...report.consumptionRows,
    ...report.stockRows,
  ];

  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(
    `sangbenin_export_${stamp}.csv`,
    toCsv(rows),
    "text/csv;charset=utf-8;",
  );
}

function exportExcelReport() {
  const report = buildExportRows();
  if (!window.XLSX) {
    alert(
      "L'export Excel n'est pas disponible dans cette session. Veuillez réessayer ou utiliser l'export CSV.",
    );
    return;
  }

  const wb = XLSX.utils.book_new();
  const executiveSheet = XLSX.utils.aoa_to_sheet([
    ["Rapport institutionnel SangBenin"],
    ["Date d'export", new Date().toISOString()],
    ["Période analysée", `${report.periodDays} jours`],
    ["Centres total", centers.length],
    ["Centres ouverts", centers.filter((c) => c.isOpen).length],
    ["Centres critiques", report.insights.criticalCenters.length],
    ["Centres obsolètes", report.insights.staleCenters.length],
    ["Mouvements enregistrés", movements.length],
    ["Tendance 7j", formatPercent(report.insights.delta)],
    [
      "Top groupe sollicité",
      report.insights.topBloods[0]
        ? `${report.insights.topBloods[0].bloodType} (${report.insights.topBloods[0].score})`
        : "N/A",
    ],
    [
      "Centre le plus actif",
      report.insights.topCenters[0]
        ? `${report.insights.topCenters[0].center.name} (${report.insights.topCenters[0].score})`
        : "N/A",
    ],
  ]);

  executiveSheet["!cols"] = [{ wch: 24 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, executiveSheet, "Rapport");

  const sheets = [
    ["Résumé", report.summaryRows],
    ["Alertes", report.alertRows],
    ["Insights", report.insightRows],
    ["Recommandations", report.recommendationRows],
    ["Consommation", report.consumptionRows],
    ["Stocks", report.stockRows],
  ];

  sheets.forEach(([name, rows]) => {
    const ws = XLSX.utils.json_to_sheet(rows);
    const cols = Object.keys(rows[0] || {}).map(() => ({ wch: 18 }));
    if (rows.length > 0) {
      const widths = Object.keys(rows[0]).map((key) => ({
        wch: Math.max(
          key.length,
          ...rows.map((row) => String(row[key] ?? "").length),
          12,
        ),
      }));
      ws["!cols"] = widths;
    } else {
      ws["!cols"] = cols;
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  });

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `sangbenin_rapport_${stamp}.xlsx`);
}

function attachExportActions() {
  const csvBtn = document.getElementById("export-csv-btn");
  const excelBtn = document.getElementById("export-excel-btn");

  if (csvBtn) {
    csvBtn.addEventListener("click", exportCsvReport);
  }

  if (excelBtn) {
    excelBtn.addEventListener("click", exportExcelReport);
  }
}

function getPriorityAlerts() {
  const alerts = [];

  centers.forEach((center) => {
    const centerAlerts = Array.isArray(center.alerts) ? center.alerts : [];
    centerAlerts.forEach((alert) => {
      const levelScore =
        alert.level === "rupture" ? 3 : alert.level === "critique" ? 2 : 1;
      alerts.push({
        centerName: center.name,
        level: alert.level,
        levelScore,
        message: alert.message,
        age: formatRelativeAge(center.lastUpdated || new Date().toISOString()),
      });
    });

    if (isStale(center.lastUpdated)) {
      alerts.push({
        centerName: center.name,
        level: "info",
        levelScore: 0,
        message: "Données non rafraîchies",
        age: formatRelativeAge(center.lastUpdated),
      });
    }
  });

  return alerts.sort((a, b) => b.levelScore - a.levelScore).slice(0, 6);
}

function renderPriorityAlerts() {
  const tbody = document.getElementById("priority-alerts-tbody");
  const meta = document.getElementById("priority-alerts-meta");
  if (!tbody || !meta) return;

  const alerts = getPriorityAlerts();
  meta.textContent = alerts.length
    ? `${alerts.length} alerte(s) prioritaire(s) détectée(s)`
    : "Aucune alerte prioritaire pour le moment.";

  if (alerts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-6 text-center text-xs text-on-surface-variant">Tout est stable pour le moment.</td></tr>`;
    return;
  }

  tbody.innerHTML = alerts
    .map(
      (alert) => `
    <tr class="align-top">
      <td class="px-4 py-3">
        <span class="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
          alert.level === "rupture"
            ? "bg-red-100 text-red-700"
            : alert.level === "critique"
              ? "bg-amber-100 text-amber-700"
              : "bg-slate-100 text-slate-600"
        }">${alert.level}</span>
      </td>
      <td class="px-4 py-3 font-semibold text-on-surface">${alert.centerName}</td>
      <td class="px-4 py-3 text-on-surface-variant">${alert.message}</td>
      <td class="px-4 py-3 text-xs text-on-surface-variant">${alert.age}</td>
    </tr>
  `,
    )
    .join("");
}

function renderDataCharts() {
  const consumptionEl = document.getElementById("consumption-chart");
  const stockEl = document.getElementById("stock-chart");
  const periodChip = document.getElementById("consumption-period-chip");
  const periodLabel = document.getElementById("consumption-period-label");
  if (!consumptionEl || !stockEl) return;

  const days = getSelectedChartPeriod();
  const consumption = getConsumptionDataset(days);

  if (periodChip) periodChip.textContent = `${days}j`;
  if (periodLabel)
    periodLabel.textContent = `Volume des mouvements sur ${days} jours`;

  consumptionEl.innerHTML = `
    ${buildLineChartSVG(consumption.values)}
    <div class="chart-legend">
      ${consumption.labels.map((label, i) => `<span${i >= consumption.labels.length - 5 ? ' class="visible"' : ""}>${label}</span>`).join("")}
    </div>
    <div class="chart-summary">
      <span><strong>${consumption.lastSeven}</strong> sur les 7 derniers jours</span>
      <span><strong>${consumption.prevSeven}</strong> sur les 7 jours précédents</span>
    </div>`;

  const stockItems = getStockDataset()
    .slice(0, 6)
    .map((c) => ({
      label: c.name.length > 18 ? c.name.slice(0, 18) + "…" : c.name,
      value: c.totalStock,
    }));

  stockEl.innerHTML = buildBarChartHTML(
    stockItems,
    "Aucune donnée de stock disponible.",
  );
}

function getInsightData() {
  const now = Date.now();
  const windowStart = now - INSIGHT_WINDOW_DAYS * 24 * 3600000;
  const last7Start = now - 7 * 24 * 3600000;
  const prev7Start = now - 14 * 24 * 3600000;

  const recentMovements = movements.filter((m) => {
    const time = getMovementDate(m).getTime();
    return Number.isFinite(time) && time >= windowStart;
  });

  const topBloodMap = new Map();
  const centerScoreMap = new Map();
  let last7 = { entree: 0, sortie: 0, perte: 0 };
  let prev7 = { entree: 0, sortie: 0, perte: 0 };

  for (const m of recentMovements) {
    const qty = Number(m.quantity) || 0;
    const weight = m.type === "entree" ? qty : qty * 1.2;
    topBloodMap.set(m.bloodType, (topBloodMap.get(m.bloodType) || 0) + weight);

    centerScoreMap.set(m.centerId, (centerScoreMap.get(m.centerId) || 0) + qty);

    const time = getMovementDate(m).getTime();
    if (time >= last7Start) last7[m.type] = (last7[m.type] || 0) + qty;
    else if (time >= prev7Start) prev7[m.type] = (prev7[m.type] || 0) + qty;
  }

  const topBloods = [...topBloodMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([bloodType, score]) => ({ bloodType, score: Math.round(score) }));

  const topCenters = [...centerScoreMap.entries()]
    .map(([centerId, score]) => ({
      centerId,
      score,
      center: centers.find((c) => c.id === centerId),
    }))
    .filter((item) => item.center)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const criticalCenters = centers.filter(
    (c) =>
      c.alerts &&
      c.alerts.some((a) => a.level === "critique" || a.level === "rupture"),
  );
  const staleCenters = centers.filter((c) => isStale(c.lastUpdated));

  const last7Total = last7.entree + last7.sortie + last7.perte;
  const prev7Total = prev7.entree + prev7.sortie + prev7.perte;
  const delta =
    prev7Total === 0 ? null : ((last7Total - prev7Total) / prev7Total) * 100;

  return {
    topBloods,
    topCenters,
    criticalCenters,
    staleCenters,
    last7Total,
    prev7Total,
    delta,
  };
}

function renderInsights() {
  const grid = document.getElementById("insights-grid");
  const footer = document.getElementById("insights-footer");
  if (!grid || !footer) return;

  const data = getInsightData();
  const topBloodsHtml = data.topBloods.length
    ? data.topBloods
        .map(
          (item, index) => `
      <div class="insight-list-item">
        <div class="insight-rank">${index + 1}</div>
        <div class="insight-body">
          <div class="insight-label">${item.bloodType}</div>
          <div class="insight-bar"><span style="width:${Math.min(100, item.score * 8)}%"></span></div>
        </div>
        <div class="insight-value">${item.score}</div>
      </div>`,
        )
        .join("")
    : '<div class="insight-empty">Aucun mouvement récent.</div>';

  const topCentersHtml = data.topCenters.length
    ? data.topCenters
        .map(
          (item, index) => `
      <div class="insight-list-item">
        <div class="insight-rank">${index + 1}</div>
        <div class="insight-body">
          <div class="insight-label">${item.center.name}</div>
          <div class="insight-meta">${item.center.quartier}, ${item.center.zone}</div>
        </div>
        <div class="insight-value">${item.score}</div>
      </div>`,
        )
        .join("")
    : '<div class="insight-empty">Aucune activité enregistrée.</div>';

  const trendClass =
    data.delta == null ? "neutral" : data.delta >= 0 ? "up" : "down";
  const trendLabel =
    data.delta == null
      ? "N/A"
      : `${data.delta >= 0 ? "+" : ""}${data.delta.toFixed(1)}%`;

  grid.innerHTML = `
    <article class="rounded-3xl border border-outline-variant/10 bg-surface-container-low p-4 shadow-sm">
      <div class="flex items-center justify-between gap-3 mb-4">
        <span class="text-sm font-bold text-on-surface">Top groupes moteurs</span>
        <span class="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">${INSIGHT_WINDOW_DAYS}j</span>
      </div>
      <div class="space-y-3">${topBloodsHtml}</div>
    </article>

    <article class="rounded-3xl border border-outline-variant/10 bg-surface-container-low p-4 shadow-sm">
      <div class="flex items-center justify-between gap-3 mb-4">
        <span class="text-sm font-bold text-on-surface">Centres les plus actifs</span>
        <span class="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">Top 3</span>
      </div>
      <div class="space-y-3">${topCentersHtml}</div>
    </article>

    <article class="rounded-3xl border border-outline-variant/10 bg-surface-container-low p-4 shadow-sm">
      <div class="flex items-center justify-between gap-3 mb-4">
        <span class="text-sm font-bold text-on-surface">Santé du stock</span>
        <span class="inline-flex items-center rounded-full bg-secondary/10 px-3 py-1 text-xs font-bold text-secondary">Alerte</span>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="rounded-2xl bg-white/80 border border-outline-variant/10 p-3">
          <strong class="block text-2xl font-black text-primary">${data.criticalCenters.length}</strong>
          <span class="text-xs text-on-surface-variant">centres en tension</span>
        </div>
        <div class="rounded-2xl bg-white/80 border border-outline-variant/10 p-3">
          <strong class="block text-2xl font-black text-primary">${data.staleCenters.length}</strong>
          <span class="text-xs text-on-surface-variant">données à rafraîchir</span>
        </div>
      </div>
    </article>

    <article class="rounded-3xl border border-outline-variant/10 bg-surface-container-low p-4 shadow-sm">
      <div class="flex items-center justify-between gap-3 mb-4">
        <span class="text-sm font-bold text-on-surface">Tendance ${INSIGHT_WINDOW_DAYS}j</span>
        <span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${
          trendClass === "up"
            ? "bg-green-100 text-green-700"
            : trendClass === "down"
              ? "bg-red-100 text-red-700"
              : "bg-slate-100 text-slate-700"
        }">${trendLabel}</span>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="rounded-2xl bg-white/80 border border-outline-variant/10 p-3">
          <strong class="block text-2xl font-black text-primary">${data.last7Total}</strong>
          <span class="text-xs text-on-surface-variant">mouvements 7j</span>
        </div>
        <div class="rounded-2xl bg-white/80 border border-outline-variant/10 p-3">
          <strong class="block text-2xl font-black text-primary">${data.prev7Total}</strong>
          <span class="text-xs text-on-surface-variant">7j précédents</span>
        </div>
      </div>
    </article>`;

  footer.textContent = `Synthèse calculée à partir de ${movements.length} mouvement(s) et ${centers.length} centre(s).`;
}

// ─── VUE D'ENSEMBLE ───────────────────────────────────────────────────────────

function renderOverview() {
  const open = centers.filter((c) => c.isOpen).length;
  const alertsCount = centers.filter(
    (c) => c.alerts && c.alerts.length > 0,
  ).length;
  const critiquesCount = centers.reduce((n, c) => {
    return (
      n + (c.alerts ? c.alerts.filter((a) => a.level === "critique").length : 0)
    );
  }, 0);

  document.getElementById("stat-total").textContent = centers.length;
  document.getElementById("stat-open").textContent = open;
  document.getElementById("stat-closed").textContent = centers.length - open;
  document.getElementById("stat-alerts").textContent = alertsCount;
  document.getElementById("stat-critiques").textContent = critiquesCount;

  renderAlertsBanner();
  renderInsights();
  renderDataCharts();
  renderPriorityAlerts();
  renderCentersGrid();
}

function renderAlertsBanner() {
  const banner = document.getElementById("alerts-banner");
  const list = document.getElementById("alerts-list");

  const alertItems = [];
  centers.forEach((c) => {
    if (!c.alerts || c.alerts.length === 0) return;
    c.alerts.forEach((a) => {
      alertItems.push({ centerName: c.name, ...a });
    });
  });

  if (alertItems.length === 0) {
    banner.style.display = "none";
    return;
  }

  banner.style.display = "block";
  list.innerHTML = alertItems
    .map(
      (a) => `
    <div class="flex items-start gap-3 p-3 rounded-2xl border ${
      a.level === "rupture"
        ? "border-red-200 bg-red-50"
        : "border-amber-200 bg-amber-50"
    }">
      <span class="mt-1 w-2 h-2 rounded-full ${
        a.level === "rupture" ? "bg-red-600" : "bg-amber-500"
      } shrink-0"></span>
      <div>
        <p class="text-sm font-bold text-on-surface">${a.centerName}</p>
        <p class="text-xs text-on-surface-variant">${a.message}</p>
      </div>
    </div>
  `,
    )
    .join("");
}

function renderCentersGrid() {
  const grid = document.getElementById("centers-grid");
  grid.innerHTML = centers
    .map((c) => {
      const hasAlert = c.alerts && c.alerts.length > 0;
      const stale = isStale(c.lastUpdated);

      const stockCells = BLOOD_TYPES.map((t) => {
        const s = c.stock[t] || { quantity: 0, level: "rupture" };
        return `
        <div class="flex flex-col items-center p-2 bg-white rounded-xl border border-outline-variant/20 ${
          s.level === "stable"
            ? ""
            : s.level === "faible"
              ? "ring-1 ring-amber-200"
              : s.level === "critique"
                ? "ring-1 ring-red-200"
                : "opacity-70"
        }">
          <span class="text-[10px] font-black text-on-surface-variant">${t}</span>
          <span class="mt-1 text-sm font-black text-on-surface">${s.quantity}</span>
          <span class="mt-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${
            s.level === "stable"
              ? "bg-green-500 text-white"
              : s.level === "faible"
                ? "bg-amber-500 text-white"
                : s.level === "critique"
                  ? "bg-secondary text-white"
                  : "bg-slate-200 text-slate-600"
          }">${levelLabel(s.level)}</span>
        </div>`;
      }).join("");

      return `
      <div class="p-4 bg-surface-container-low rounded-3xl border ${hasAlert ? "border-secondary/30" : "border-outline-variant/10"} shadow-sm">
        <div class="flex items-center justify-between mb-4 gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <span class="material-symbols-outlined text-sm">apartment</span>
            </div>
            <span class="font-title-md text-on-surface truncate">${c.name}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="flex items-center gap-1.5 px-3 py-1 bg-surface-container-highest/60 rounded-full border border-outline-variant/20 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
              <span class="material-symbols-outlined text-[14px] text-on-surface-variant">lock</span>
              Lecture seule
            </span>
            <span class="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${c.isOpen ? "bg-green-500/10 text-green-700" : "bg-surface-variant/60 text-on-surface-variant"}">${c.isOpen ? "Ouvert" : "Fermé"}</span>
          </div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2">${stockCells}</div>
        <div class="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-on-surface-variant">
          <span>${stale ? `Données > ${STALE_HOURS}h — mis à jour le ${fmtDate(c.lastUpdated)}` : `Mis à jour le ${fmtDate(c.lastUpdated)}`}</span>
          <div class="flex gap-2">
            <button class="px-3 py-2 rounded-xl bg-secondary text-white text-xs font-bold hover:opacity-90" onclick="openMovementModal(${c.id})">+ Mouvement</button>
            <button class="px-3 py-2 rounded-xl bg-white border border-outline-variant/20 text-xs font-bold text-on-surface hover:bg-surface-container-high" onclick="openStockModal(${c.id})">Modifier stock</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

// ─── MODAL MOUVEMENT ──────────────────────────────────────────────────────────

function openMovementModal(centerId) {
  movementCenterId = centerId;
  const center = centers.find((c) => c.id === centerId);
  document.getElementById("movement-modal-title").textContent =
    center.name + " — Mouvement";
  document.getElementById("mv-type").value = "entree";
  document.getElementById("mv-blood").value = "O+";
  document.getElementById("mv-qty").value = "1";
  document.getElementById("mv-note").value = "";
  const fb = document.getElementById("mv-feedback");
  fb.className = "feedback";
  fb.textContent = "";
  document.getElementById("modal-movement").classList.add("active");
}

document.getElementById("mv-cancel").addEventListener("click", () => {
  document.getElementById("modal-movement").classList.remove("active");
});
document.getElementById("modal-movement").addEventListener("click", (e) => {
  if (e.target === document.getElementById("modal-movement"))
    document.getElementById("modal-movement").classList.remove("active");
});

document.getElementById("mv-save").addEventListener("click", async () => {
  const type = document.getElementById("mv-type").value;
  const bloodType = document.getElementById("mv-blood").value;
  const quantity = parseInt(document.getElementById("mv-qty").value);
  const note = document.getElementById("mv-note").value;
  const fb = document.getElementById("mv-feedback");

  if (!quantity || quantity <= 0) {
    fb.className = "feedback error";
    fb.textContent = "La quantité doit être supérieure à 0.";
    return;
  }

  try {
    const res = await fetch(`/api/admin/centers/${movementCenterId}/movement`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + authToken,
      },
      body: JSON.stringify({ type, bloodType, quantity, note }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Erreur");
    }

    const data = await res.json();
    centers = centers.map((c) => (c.id === movementCenterId ? data.center : c));
    movements.unshift(data.movement);

    fb.className = "feedback success";
    fb.textContent = "Mouvement enregistré.";
    renderOverview();
    setTimeout(() => {
      document.getElementById("modal-movement").classList.remove("active");
    }, 800);
  } catch (err) {
    fb.className = "feedback error";
    fb.textContent = err.message || "Erreur lors de l'enregistrement.";
  }
});

// ─── MODAL STOCK ──────────────────────────────────────────────────────────────

function openStockModal(centerId) {
  editingCenterId = centerId;
  const center = centers.find((c) => c.id === centerId);
  document.getElementById("stock-modal-title").textContent =
    center.name + " — Stock";
  document.getElementById("stock-is-open").checked = center.isOpen;

  const grid = document.getElementById("stock-edit-grid");
  grid.innerHTML = BLOOD_TYPES.map((t) => {
    const qty = center.stock[t] ? center.stock[t].quantity : 0;
    return `
      <div class="stock-edit-item">
        <label>${t}</label>
        <input type="number" id="stock-qty-${t.replace("+", "plus").replace("-", "minus")}" min="0" value="${qty}" />
      </div>`;
  }).join("");

  const fb = document.getElementById("stock-feedback");
  fb.className = "feedback";
  fb.textContent = "";
  document.getElementById("modal-stock").classList.add("active");
}

document.getElementById("stock-cancel").addEventListener("click", () => {
  document.getElementById("modal-stock").classList.remove("active");
});
document.getElementById("modal-stock").addEventListener("click", (e) => {
  if (e.target === document.getElementById("modal-stock"))
    document.getElementById("modal-stock").classList.remove("active");
});

document.getElementById("stock-save").addEventListener("click", async () => {
  const isOpen = document.getElementById("stock-is-open").checked;
  const fb = document.getElementById("stock-feedback");

  const stock = {};
  BLOOD_TYPES.forEach((t) => {
    const key = t.replace("+", "plus").replace("-", "minus");
    const val =
      parseInt(document.getElementById(`stock-qty-${key}`).value) || 0;
    stock[t] = val;
  });

  try {
    const res = await fetch(`/api/admin/centers/${editingCenterId}/stock`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + authToken,
      },
      body: JSON.stringify({ stock, isOpen }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Erreur");
    }

    const updated = await res.json();
    centers = centers.map((c) => (c.id === editingCenterId ? updated : c));

    fb.className = "feedback success";
    fb.textContent = "Stock mis à jour.";
    renderOverview();
    setTimeout(() => {
      document.getElementById("modal-stock").classList.remove("active");
    }, 800);
  } catch (err) {
    fb.className = "feedback error";
    fb.textContent = err.message || "Erreur lors de la sauvegarde.";
  }
});

// ─── MOUVEMENTS ───────────────────────────────────────────────────────────────

function populateCenterFilter() {
  const sel = document.getElementById("filter-center");
  centers.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
}

["filter-center", "filter-type", "filter-blood"].forEach((id) => {
  document.getElementById(id).addEventListener("change", renderMovementsTable);
});

function renderMovementsTable() {
  const centerFilter = document.getElementById("filter-center").value;
  const typeFilter = document.getElementById("filter-type").value;
  const bloodFilter = document.getElementById("filter-blood").value;

  let filtered = movements;
  if (centerFilter)
    filtered = filtered.filter((m) => m.centerId === parseInt(centerFilter));
  if (typeFilter) filtered = filtered.filter((m) => m.type === typeFilter);
  if (bloodFilter)
    filtered = filtered.filter((m) => m.bloodType === bloodFilter);

  const tbody = document.getElementById("movements-tbody");
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="px-4 py-6 text-center text-xs text-on-surface-variant">Aucun mouvement trouvé.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (m) => `
    <tr class="align-top">
      <td class="px-4 py-3 text-xs text-on-surface-variant">${fmtDate(m.date)}</td>
      <td class="px-4 py-3 font-semibold text-on-surface">${m.centerName}</td>
      <td class="px-4 py-3"><span class="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
        m.type === "entree"
          ? "bg-green-100 text-green-700"
          : m.type === "sortie"
            ? "bg-blue-100 text-blue-700"
            : "bg-red-100 text-red-700"
      }">${m.type}</span></td>
      <td class="px-4 py-3 font-bold text-on-surface">${m.bloodType}</td>
      <td class="px-4 py-3 text-on-surface-variant">${m.quantity} poche(s)</td>
      <td class="px-4 py-3 text-on-surface-variant">${m.quantityBefore}</td>
      <td class="px-4 py-3 text-on-surface-variant">${m.quantityAfter}</td>
      <td class="px-4 py-3 text-on-surface-variant">${m.note || "—"}</td>
    </tr>`,
    )
    .join("");
}
