"use strict";
/* Paletto Auto — Intranet : interface */

const API = "/api";
const WEEKS = ["1 semaine", "2 semaines", "3 semaines", "4 semaines", "5 semaines", "6 semaines"];
const weeksOf = (v) => Math.min(6, Math.max(1, parseInt(v, 10) || 1));
const CATEGORIES = ["Neuf", "Occasion"];
const catOf = (c) => (CATEGORIES.includes(c.categorie) ? c.categorie : "Non classé");
// Permissions qu'on peut cocher pour chaque grade
const PERMS = [
  ["dossiers.creer", "Créer des dossiers", "Ventes, clients, partenariats"],
  ["dossiers.modifier_siens", "Modifier ses propres dossiers", "Ceux qu'il a créés ou dont il est le vendeur"],
  ["dossiers.modifier_tous", "Modifier tous les dossiers", "Y compris ceux des collègues"],
  ["dossiers.supprimer", "Supprimer des dossiers", "Retire aussi le montant du CA"],
  ["dossiers.attribuer", "Choisir le vendeur responsable", "Sinon, le dossier lui est attribué automatiquement"],
  ["ca.equipe", "Voir le CA de toute l'équipe", "Classement et historique des semaines"],
  ["ca.cloturer", "Clôturer la semaine", "Remise à zéro du CA et gestion de l'historique"],
  ["catalogue.gerer", "Gérer les véhicules, la vitrine et les événements", "Liste des prix, occasions en vitrine, textes du site public, événements"],
  ["employes.voir", "Voir la page Employés", "Liste de l'équipe"],
  ["employes.gerer", "Gérer les comptes employés", "Créer, modifier, mots de passe, supprimer"],
  ["grades.gerer", "Gérer les grades", "Créer des grades et choisir leurs permissions"],
  ["depenses.gerer", "Gérer les dépenses", "Voir et enregistrer les dépenses, voir le bénéfice"],
  ["journal.voir", "Consulter le journal d'activité", "Qui a créé, modifié ou supprimé quoi"],
  ["rdv.gerer", "Traiter les demandes de rendez-vous", "Demandes envoyées par les clients depuis la vitrine"],
  ["recrutement.gerer", "Gérer les candidatures", "Candidatures reçues depuis la page Recrutement"],
];
const PERM_LABEL = Object.fromEntries(PERMS.map(([k, l]) => [k, l]));
const gradeClass = (g) => (["stagiaire", "agent", "vendeur", "responsable", "directeur"].includes(String(g).toLowerCase()) ? `grade-${String(g).toLowerCase()}` : "grade-custom");
const gradeTag = (g) => `<span class="grade ${gradeClass(g)}">${esc(g)}</span>`;

const TYPES = {
  ventes: {
    label: "Ventes", singular: "vente", fem: true, kicker: "GESTION COMMERCIALE", photo: true,
    desc: "Enregistrez les ventes de véhicules conclues : chacune compte immédiatement dans le CA. Choisissez un partenariat pour appliquer automatiquement sa remise.",
    fields: [
      { key: "vehicule", label: "Véhicule (modèle)", type: "vehicle", required: true, placeholder: "Tapez pour chercher dans la liste…", full: true },
      { key: "plaque", label: "Plaque d'immatriculation", type: "text", placeholder: "ex. 12ABC345" },
      { key: "client", label: "Client", type: "client", placeholder: "Nom du client" },
      { key: "prix_base", label: "Prix de base ($)", type: "money" },
      { key: "partenariat", label: "Partenariat (remise)", type: "partner" },
      { key: "prix", label: "Prix de vente final ($)", type: "money", required: true },
      { key: "agent", label: "Vendeur responsable", type: "user" },
      { key: "notes", label: "Notes", type: "long", placeholder: "Options, reprise, conditions…" },
    ],
    title: (d) => d.vehicule || d.bien, amount: "prix",
    sub: (d) => [d.plaque && `Plaque ${d.plaque}`, d.client && `Client : ${d.client}`, d.partenariat && `Partenaire : ${d.partenariat}${d.remise ? ` (−${d.remise} %)` : ""}`, d.notes].filter(Boolean).join(" • "),
  },
  clients: {
    label: "Clients", singular: "client", kicker: "PORTEFEUILLE",
    desc: "Retrouvez les contacts de vos clients, leur employeur ou groupe, ainsi que leurs achats.",
    fields: [
      { key: "nom", label: "Nom Prénom", type: "text", required: true, placeholder: "ex. De Santa Michael", full: true },
      { key: "telephone", label: "Numéro de téléphone", type: "text", placeholder: "ex. 555-0123" },
      { key: "employeur", label: "Employeur / groupe", type: "text", placeholder: "ex. LSPD, Benny's, Vagos…" },
      { key: "liste_noire", label: "Client sur liste noire (avertir les agents)", type: "bool" },
      { key: "motif", label: "Motif de la liste noire", type: "text", placeholder: "ex. impayé, comportement…", full: true },
    ],
    title: (d) => d.nom,
    sub: (d) => [d.telephone && `☎ ${d.telephone}`, d.employeur && `Employeur / groupe : ${d.employeur}`].filter(Boolean).join(" • "),
  },
  partenariats: {
    label: "Partenariats", singular: "partenariat", kicker: "RELATIONS PROFESSIONNELLES",
    desc: "Centralisez les accords professionnels de l'agence. La remise indiquée s'applique automatiquement aux ventes liées au partenariat.",
    fields: [
      { key: "organisation", label: "Organisation", type: "text", required: true, placeholder: "ex. Benny's Motorworks" },
      { key: "contact", label: "Personne de contact", type: "text", placeholder: "Nom et téléphone" },
      { key: "type", label: "Type de partenariat", type: "text", placeholder: "ex. Remise, apport d'affaires…" },
      { key: "remise", label: "Remise accordée (%)", type: "percent" },
      { key: "notes", label: "Notes", type: "long", placeholder: "Termes de l'accord…" },
    ],
    title: (d) => d.organisation,
    sub: (d) => [d.contact && `Contact : ${d.contact}`, d.type, partnerSales(d.organisation), d.notes].filter(Boolean).join(" • "),
  },
};
TYPES.depenses = {
  label: "Dépenses", singular: "dépense", fem: true, kicker: "GESTION FINANCIÈRE", perm: "depenses.gerer",
  desc: "Enregistrez les dépenses de l'entreprise (achats de véhicules, salaires, frais…). Elles sont déduites du CA pour calculer le bénéfice de la semaine.",
  fields: [
    { key: "libelle", label: "Libellé", type: "text", required: true, placeholder: "ex. Commande de 3 véhicules, salaires semaine 12", full: true },
    { key: "categorie", label: "Catégorie", type: "select", options: ["Achat de véhicules", "Salaires", "Frais de fonctionnement", "Autre"] },
    { key: "montant", label: "Montant ($)", type: "money", required: true },
    { key: "notes", label: "Notes", type: "long", placeholder: "Détails…" },
  ],
  title: (d) => d.libelle, amount: "montant",
  sub: (d) => [d.categorie, d.notes].filter(Boolean).join(" • "),
};
const typeAllowed = (t) => !TYPES[t].perm || can(TYPES[t].perm);
const STATUS_CLASS = { "Vendue": "ok", "Active": "ok", "Actif": "ok", "En cours": "pending", "En négociation": "pending", "Terminée": "done", "Terminé": "done", "Annulée": "bad" };

const state = {
  token: "", me: null, records: {}, users: [], ca: null, catalog: [], grades: [], editingGrade: null, editingCatalog: null, catFilter: "all", catalogPhoto: { changed: false, data: null },
  page: "dashboard", type: "ventes", filter: "all", editing: null, editingUser: null,
};
try { state.token = localStorage.getItem("pa_token") || ""; } catch { /* stockage indisponible */ }

/* ---------- utilitaires ---------- */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = new Intl.NumberFormat("fr-FR");
const money = (n) => `${nf.format(Math.round(n || 0))} $`;
const isDirector = () => state.me?.grade === "Directeur";
const can = (perm) => isDirector() || (state.me?.permissions || []).includes(perm);
const canEdit = (rec, type = state.type) => TYPES[type]?.perm ? can(TYPES[type].perm) : can("dossiers.modifier_tous") || (can("dossiers.modifier_siens") && (rec.created_by === state.me.username || rec.agent === state.me.username));
const canDelete = (type = state.type) => (TYPES[type]?.perm ? can(TYPES[type].perm) : can("dossiers.supprimer"));
const canSeeUsers = () => can("employes.voir") || can("employes.gerer");
const userName = (u) => state.users.find((x) => x.username === u)?.display_name || u || "—";
const dateLabel = (ts) => ts ? new Date(Number(ts)).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const dateTime = (ts) => ts ? new Date(Number(ts)).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const badge = (s) => s ? `<span class="badge ${STATUS_CLASS[s] || ""}">${esc(s)}</span>` : "";
const article = (t) => (TYPES[t].fem ? "une " : "un ") + TYPES[t].singular;

function saveToken(t) {
  state.token = t;
  try { t ? localStorage.setItem("pa_token", t) : localStorage.removeItem("pa_token"); } catch { /* ignore */ }
}

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${API}/${path}`, {
      method,
      headers: { "content-type": "application/json", ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Impossible de joindre le serveur. Vérifiez votre connexion.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.me) sessionExpired();
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, kind = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.textContent = label || "Patientez…"; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

function openModal(id) { $("#" + id).classList.remove("hidden"); document.body.classList.add("modal-open"); }
function closeModal(id) {
  $("#" + id).classList.add("hidden");
  if (!$$(".modal-backdrop").some((m) => !m.classList.contains("hidden"))) document.body.classList.remove("modal-open");
}

function confirmDialog(title, text, okLabel = "Supprimer") {
  return new Promise((resolve) => {
    $("#confirmTitle").textContent = title;
    $("#confirmText").textContent = text;
    $("#confirmOk").textContent = okLabel;
    openModal("confirmModal");
    const done = (v) => { closeModal("confirmModal"); $("#confirmOk").onclick = $("#confirmCancel").onclick = null; resolve(v); };
    $("#confirmOk").onclick = () => done(true);
    $("#confirmCancel").onclick = () => done(false);
    setTimeout(() => $("#confirmCancel").focus(), 30);
  });
}

/* ---------- écrans ---------- */

function showLogin(needsSetup = false, message = "") {
  $("#app").classList.add("hidden");
  $("#publicSite").classList.add("hidden");
  $("#loginScreen").classList.remove("hidden");
  $("#backToPublic").classList.toggle("hidden", needsSetup);
  $("#loginBlock").classList.toggle("hidden", needsSetup);
  $("#setupBlock").classList.toggle("hidden", !needsSetup);
  $("#loginError").textContent = message;
  setTimeout(() => (needsSetup ? $("#setupForm [name=display_name]") : $("#username")).focus(), 50);
}

function sessionExpired() {
  saveToken("");
  state.me = null;
  closeAllModals();
  showLogin(false, "Votre session a expiré. Reconnectez-vous.");
}

function closeAllModals() { $$(".modal-backdrop").forEach((m) => m.classList.add("hidden")); document.body.classList.remove("modal-open"); }

async function enterApp() {
  const me = state.me;
  $("#loginScreen").classList.add("hidden");
  $("#publicSite").classList.add("hidden");
  $("#app").classList.remove("hidden");
  applyPermissions();
  $("#todayDate").textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("#welcomeTitle").innerHTML = `Bonjour, ${esc(me.display_name.split(" ")[0])}<span class="emerald">.</span>`;
  const startPage = (location.hash || "").slice(1);
  go(isValidPage(startPage) ? startPage : "dashboard", false);
  await loadAll();
}

const canRequests = () => can("rdv.gerer") || can("recrutement.gerer");
const isValidPage = (p) => (p === "requests" && canRequests()) || ["dashboard", "ca", "account", "events", "catalog", "occasions", ...Object.keys(TYPES).filter(typeAllowed)].includes(p) || (p === "journal" && can("journal.voir")) || (p === "users" && canSeeUsers()) || (p === "grades" && can("grades.gerer"));

// Affiche ou masque les menus et boutons selon les permissions du grade
function applyPermissions() {
  const me = state.me;
  $("#topUsername").textContent = me.display_name;
  $("#topGrade").textContent = me.grade;
  $("#avatar").textContent = (me.display_name || me.username).slice(0, 1).toUpperCase();
  $("#usersNav").classList.toggle("hidden", !canSeeUsers());
  $("#gradesNav").classList.toggle("hidden", !can("grades.gerer"));
  $("#depensesNav").classList.toggle("hidden", !can("depenses.gerer"));
  $("#journalNav").classList.toggle("hidden", !can("journal.voir"));
  $("#requestsNav").classList.toggle("hidden", !canRequests());
  $("#addEventBtn").classList.toggle("hidden", !can("catalogue.gerer"));
  $("#vitrineBtn").classList.toggle("hidden", !can("catalogue.gerer"));
  $("#objectivesBtn").classList.toggle("hidden", !can("ca.cloturer"));
  $("#addUserBtn").classList.toggle("hidden", !can("employes.gerer"));
  $("#resetCaBtn").classList.toggle("hidden", !can("ca.cloturer"));
  $("#addRecordBtn").classList.toggle("hidden", !can("dossiers.creer"));
  $$("[data-quick]").forEach((b) => b.classList.toggle("hidden", !can("dossiers.creer")));
  if (!isValidPage(state.page)) go("dashboard", false);
}

/* ---------- données ---------- */

let loading = null;
async function loadAll() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const types = Object.keys(TYPES).filter(typeAllowed);
      const [me, users, ca, catalog, grades, events, reqs, profs, ...lists] = await Promise.all([api("me"), api("users"), api("ca"), api("catalog").catch(() => []), api("grades").catch(() => []), api("events").catch(() => []), canRequests() ? api("requests").catch(() => []) : Promise.resolve([]), api("profiles").catch(() => []), ...types.map((t) => api(`records/${t}`))]);
      const permsChanged = JSON.stringify([me.grade, me.permissions]) !== JSON.stringify([state.me.grade, state.me.permissions]);
      state.me = me;
      state.grades = grades;
      if (permsChanged) applyPermissions();
      state.users = users;
      state.events = events;
      state.profiles = Object.fromEntries((profs || []).map((p) => [p.username, p]));
      state.requests = reqs;
      state.catalog = catalog;
      state.ca = ca;
      types.forEach((t, i) => (state.records[t] = lists[i]));
      $("#syncLabel").textContent = `MIS À JOUR À ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
      render();
    } catch (e) {
      if (state.me) toast(e.message, "error");
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function render() {
  if (!state.me) return;
  renderDashboard();
  if (TYPES[state.page]) renderRecords();
  if (state.page === "ca") renderCA();
  if (state.page === "users") renderUsers();
  if (state.page === "account") renderAccount();
  if (state.page === "catalog" || state.page === "occasions") renderCatalog();
  if (state.page === "grades") renderGrades();
  if (state.page === "journal") renderJournal();
  if (state.page === "requests") renderRequests();
  if (state.page === "events") renderEvents();
  updateRequestsBadge();
}

/* ---------- navigation ---------- */

function go(page, doRender = true) {
  if (!isValidPage(page)) page = "dashboard";
  const prev = state.page;
  state.page = page;
  if (TYPES[page]) {
    if (state.type !== page) { $("#recordSearch").value = ""; state.filter = "all"; $("#mineOnly").checked = false; }
    state.type = page;
  }
  $$(".page").forEach((p) => p.classList.remove("active"));
  $(`#page-${TYPES[page] ? "records" : page === "occasions" ? "catalog" : page}`).classList.add("active");
  $$(".side-link").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  const crumbs = { requests: "DEMANDES", events: "ÉVÉNEMENTS", journal: "JOURNAL D'ACTIVITÉ", grades: "GRADES & PERMISSIONS", dashboard: "TABLEAU DE BORD", catalog: "VÉHICULES NEUFS", occasions: "OCCASIONS", ca: "CHIFFRE D'AFFAIRES", users: "EMPLOYÉS", account: "MON COMPTE" };
  $("#crumb").textContent = crumbs[page] || TYPES[page].label.toUpperCase();
  if (location.hash.slice(1) !== page) history.replaceState(null, "", page === "dashboard" ? location.pathname : `#${page}`);
  closeSidebar();
  if (prev !== page) window.scrollTo(0, 0);
  if (page === "journal" && prev !== "journal") state.logs = null;
  if (doRender) render();
}

function closeSidebar() { $("#sidebar").classList.remove("open"); $("#sidebarScrim").classList.remove("show"); }

/* ---------- tableau de bord ---------- */

function renderDashboard() {
  const ca = state.ca || {};
  const r = state.records;
  const since = ca.since || 0;
  const ventesWeek = (r.ventes || []).filter((x) => x.closed_at && x.closed_at >= since).length;
  const locWeek = (r.locations || []).filter((x) => x.closed_at && x.closed_at >= since).length;
  $("#statCA").textContent = money(ca.total);
  $("#statCAProgress").innerHTML = progressHTML(ca.total, ca.objectifs?.entreprise);
  $("#statCASub").textContent = since ? `Depuis le ${dateLabel(since)}` : "Ventes encaissées";
  $("#statVentes").textContent = ventesWeek;
  $("#statVentesSub").textContent = `${(r.ventes || []).length} vente(s) au total`;
  $("#statLocations").textContent = locWeek;
  $("#statLocSub").textContent = `${(r.locations || []).length} location(s) au total`;
  $("#statClients").textContent = (r.clients || []).length;
  $("#statPartners").textContent = `${(r.partenariats || []).length} partenariat(s)`;
  $("#myCA").textContent = money(ca.mine?.total);
  $("#dashAccount").classList.toggle("hidden", !ca.compte);
  if (ca.compte) $("#dashSolde").textContent = money(ca.compte.solde);
  $("#myCAProgress").innerHTML = progressHTML(ca.mine?.total, ca.objectifs?.employe);
  $("#myPay").innerHTML = ca.paie ? myPayText(ca.paie) : "";

  const all = Object.keys(TYPES).flatMap((t) => (r[t] || []).map((x) => ({ ...x, type: t })))
    .sort((a, b) => b.updated_at - a.updated_at).slice(0, 7);
  $("#recentList").innerHTML = all.length ? all.map((x) => `
    <button class="recent-item" data-open="${x.type}:${x.id}">
      <div><b>${esc(TYPES[x.type].title(x.data))}</b><small>${esc(TYPES[x.type].label)} • ${esc(userName(x.agent || x.created_by))} • ${dateTime(x.updated_at)}</small></div>
      <span class="recent-right">${TYPES[x.type].amount ? `<span class="amount-sm">${money(x.data[TYPES[x.type].amount])}</span>` : ""}<span class="badge">${esc(TYPES[x.type].singular)}</span></span>
    </button>`).join("") : `<div class="empty-state">Aucun dossier pour le moment. Utilisez les accès rapides pour commencer.</div>`;
}

/* ---------- dossiers ---------- */

function linkedCount(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return "";
  const v = (state.records.ventes || []).filter((x) => (x.data.client || "").trim().toLowerCase() === n).length;
  const l = (state.records.locations || []).filter((x) => (x.data.locataire || "").trim().toLowerCase() === n).length;
  return [v && `${v} vente${v > 1 ? "s" : ""}`, l && `${l} location${l > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
}

function renderRecords() {
  const t = state.type, def = TYPES[t];
  const list = state.records[t] || [];
  const q = $("#recordSearch").value.trim().toLowerCase();
  const statusField = def.fields.find((f) => f.key === "statut");
  const hasAgent = def.fields.some((f) => f.type === "user");
  const mine = hasAgent && $("#mineOnly").checked;

  $("#recordsKicker").textContent = def.kicker;
  $("#recordsTitle").innerHTML = `${def.label}<span class="emerald">.</span>`;
  $("#recordsDescription").textContent = def.desc;
  $("#addRecordBtn").classList.toggle("hidden", def.perm ? !can(def.perm) : !can("dossiers.creer"));
  $("#addRecordBtn").textContent = `＋ ${def.fem ? "Nouvelle" : "Nouveau"} ${def.singular}`;
  $("#mineToggle").classList.toggle("hidden", !hasAgent);

  const counts = {};
  list.forEach((x) => (counts[x.data.statut] = (counts[x.data.statut] || 0) + 1));
  $("#statusFilters").innerHTML = statusField
    ? [["all", `Tous (${list.length})`], ...statusField.options.map((o) => [o, `${o} (${counts[o] || 0})`])]
      .map(([v, l]) => `<button class="chip ${state.filter === v ? "active" : ""}" data-filter="${esc(v)}">${esc(l)}</button>`).join("")
    : "";

  const filtered = list.filter((x) => {
    if (statusField && state.filter !== "all" && x.data.statut !== state.filter) return false;
    if (mine && x.agent !== state.me.username && x.created_by !== state.me.username) return false;
    if (!q) return true;
    const hay = [...Object.values(x.data), userName(x.agent), userName(x.created_by)].join(" ").toLowerCase();
    return hay.includes(q);
  });

  $("#recordCount").textContent = `${filtered.length} dossier${filtered.length > 1 ? "s" : ""}`;
  if (def.amount && filtered.length) {
    const sum = filtered.reduce((s, x) => s + (x.data[def.amount] || 0), 0);
    $("#recordsTotal").innerHTML = `Montant total des dossiers affichés : <b>${money(sum)}</b>`;
    $("#recordsTotal").classList.remove("hidden");
  } else $("#recordsTotal").classList.add("hidden");

  $("#recordsList").innerHTML = filtered.length ? filtered.map((x) => {
    const sub = def.sub(x.data) + (t === "clients" ? (linkedCount(x.data.nom) ? ` • ${linkedCount(x.data.nom)}` : "") : "");
    return `<article class="record-card" data-open="${t}:${x.id}" tabindex="0">
      <div class="record-main"><div class="record-title"><b>${esc(def.title(x.data))}</b>${x.data.remise && t === "partenariats" ? `<span class="badge ok">Remise ${esc(x.data.remise)} %</span>` : ""}${x.data.liste_noire && t === "clients" ? `<span class="badge bad">⚠ Liste noire</span>` : ""}${def.photo ? (x.photo_at ? `<span class="badge ok">📷 Capture</span>` : `<span class="badge bad">Capture manquante</span>`) : ""}</div><p>${esc(sub || "Aucun détail")}</p></div>
      <div class="record-meta">
        ${def.amount ? `<strong class="amount">${money(x.data[def.amount])}</strong>` : ""}
        <span title="${hasAgent ? "Agent responsable" : "Créé par"}">${esc(userName(hasAgent ? x.agent : x.created_by))}</span>
        <span>${dateLabel(x.created_at)}</span>
        <div class="record-actions">
          ${canEdit(x) ? `<button class="mini-btn" data-edit="${x.id}">Modifier</button>` : `<button class="mini-btn" data-edit="${x.id}">Voir</button>`}
          ${canDelete() ? `<button class="mini-btn danger" data-delete="${x.id}">Supprimer</button>` : ""}
        </div>
      </div></article>`;
  }).join("") : `<div class="empty-state">${list.length ? "Aucun dossier ne correspond à votre recherche." : `Aucun dossier pour l'instant. Cliquez sur « ${$("#addRecordBtn").textContent.replace("＋ ", "")} » pour commencer.`}</div>`;
}

function fieldHTML(f, val, ro, isNew = true) {
  const dis = ro ? "disabled" : "";
  const req = f.required ? "required" : "";
  const lbl = `<span>${esc(f.label)}${f.required && !ro ? ' <i class="req">*</i>' : ""}</span>`;
  const ph = esc(f.placeholder || "");
  switch (f.type) {
    case "long":
      return `<label class="full-field">${lbl}<textarea name="${f.key}" rows="3" maxlength="2000" ${dis} placeholder="${ph}">${esc(val)}</textarea></label>`;
    case "money":
      return `<label>${lbl}<input name="${f.key}" type="number" min="0" step="1" inputmode="numeric" value="${val ? esc(val) : ""}" ${req} ${dis} placeholder="ex. 250000"><small class="field-hint" data-money-for="${f.key}">${val ? money(val) : ""}</small></label>`;
    case "bool":
      return `<label class="full-field check-line danger-check"><input type="checkbox" name="${f.key}" ${val ? "checked" : ""} ${dis}> ${esc(f.label)}</label>`;
    case "percent":
      return `<label>${lbl}<input name="${f.key}" type="number" min="0" max="100" step="0.5" inputmode="decimal" value="${val ? esc(val) : ""}" ${dis} placeholder="ex. 10"></label>`;
    case "partner": {
      const list = state.records.partenariats || [];
      const opts = list.map((p) => `<option value="${esc(p.data.organisation)}" data-remise="${Number(p.data.remise) || 0}" ${p.data.organisation === val ? "selected" : ""}>${esc(p.data.organisation)} — ${p.data.remise ? `remise ${esc(p.data.remise)} %` : "sans remise"}</option>`);
      if (val && !list.some((p) => p.data.organisation === val)) opts.unshift(`<option value="${esc(val)}" data-remise="0" selected>${esc(val)} (ancien partenaire)</option>`);
      return `<label>${lbl}<select name="${f.key}" ${dis}><option value="" data-remise="0">— Aucun partenariat —</option>${opts.join("")}</select></label>`;
    }
    case "select":
      return `<label>${lbl}<select name="${f.key}" ${dis}>${f.options.map((o) => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
    case "user": {
      const locked = ro || !can("dossiers.attribuer");
      const current = val || state.me.username;
      const opts = state.users.map((u) => `<option value="${esc(u.username)}" ${u.username === current ? "selected" : ""}>${esc(u.display_name)} — ${esc(u.grade)}</option>`);
      if (!state.users.some((u) => u.username === current)) opts.unshift(`<option value="${esc(current)}" selected>${esc(current)} (ancien employé)</option>`);
      return `<label>${lbl}<select name="${f.key}" ${locked ? "disabled" : ""}>${opts.join("")}</select>${!ro && locked ? `<small class="field-hint">${isNew ? "Attribué automatiquement à vous" : "Votre grade ne permet pas de changer l'agent"}</small>` : ""}</label>`;
    }
    case "catalog": {
      const key = f.mode === "vente" ? "prix_vente" : "prix_location";
      const items = state.catalog.filter((c) => c[key] > 0);
      const optOf = (c) => `<option value="${esc(c.nom)}" data-price="${c[key]}" data-photo="${c.photo_at ? `${c.id}:${c.photo_at}` : ""}" ${c.nom === val ? "selected" : ""}>${esc(c.nom)} — ${money(c[key])}${f.mode === "location" ? " / semaine" : ""}</option>`;
      const opts = [...CATEGORIES, "Non classé"].map((cat) => {
        const group = items.filter((c) => catOf(c) === cat);
        return group.length ? `<optgroup label="${esc(cat)}">${group.map(optOf).join("")}</optgroup>` : "";
      }).filter(Boolean);
      if (val && !items.some((c) => c.nom === val)) opts.unshift(`<option value="${esc(val)}" selected>${esc(val)} (hors catalogue)</option>`);
      const hint = items.length ? (f.mode === "location" ? "Montant calculé automatiquement : prix par semaine × nombre de semaines (modifiable)." : "Le montant se remplit automatiquement, il reste modifiable.") : (can("catalogue.gerer") ? "Catalogue vide : ajoutez des biens dans « Catalogue des biens »." : "Catalogue vide : demandez à un responsable de le remplir.");
      return `<label class="full-field">${lbl}<select name="${f.key}" data-catalog="${f.mode}" ${dis}><option value="">— Hors catalogue (montant libre) —</option>${opts.join("")}</select>${ro ? "" : `<small class="field-hint">${hint}</small>`}<img class="cat-preview hidden" data-cat-preview alt=""></label>`;
    }
    case "vehicle": {
      const items = state.catalog.filter((c) => c.prix_vente > 0);
      const hint = items.length ? "Choisissez dans la liste : le prix de base se remplit tout seul (modifiable)." : (can("catalogue.gerer") ? "Liste vide : ajoutez les modèles et leurs prix dans « Véhicules »." : "Liste vide : demandez à un responsable de la remplir.");
      return `<label class="full-field">${lbl}<input name="${f.key}" list="vehicleOptions" maxlength="200" value="${esc(val)}" ${req} ${dis} placeholder="${ph}" autocomplete="off" data-vehicle>
        <datalist id="vehicleOptions">${items.map((c) => `<option value="${esc(c.nom)}">${esc(c.categorie === "Occasion" ? "Occasion • " : "")}${esc(money(c.prix_vente))}</option>`).join("")}</datalist>
        ${ro ? "" : `<small class="field-hint" data-vehicle-hint>${hint}</small>`}<img class="cat-preview hidden" data-cat-preview alt=""></label>`;
    }
    case "client":
      return `<label>${lbl}<input name="${f.key}" list="clientOptions" maxlength="200" value="${esc(val)}" ${dis} placeholder="${ph}" autocomplete="off"><small class="field-warn hidden" data-bl-for="${f.key}"></small></label>`;
    default:
      return `<label${f.full ? ' class="full-field"' : ""}>${lbl}<input name="${f.key}" maxlength="200" value="${esc(val)}" ${req} ${dis} placeholder="${ph}"></label>`;
  }
}

function openRecord(type, id = null) {
  if (state.type !== type || !TYPES[state.page]) go(type);
  const def = TYPES[type];
  const rec = id ? (state.records[type] || []).find((x) => x.id === id) : null;
  if (id && !rec) return toast("Ce dossier n'existe plus.", "error");
  const ro = !!rec && !canEdit(rec, type);
  state.editing = { type, id: rec?.id || null };

  $("#modalKicker").textContent = rec ? (ro ? "CONSULTATION" : "MODIFICATION") : "NOUVEAU DOSSIER";
  $("#modalTitle").textContent = rec ? def.title(rec.data) : `${def.fem ? "Nouvelle" : "Nouveau"} ${def.singular}`;
  $("#clientOptions").innerHTML = (state.records.clients || []).map((c) => `<option value="${esc(c.data.nom)}">`).join("");
  $("#recordFields").innerHTML = def.fields.map((f) => fieldHTML(f, rec ? (f.type === "user" ? rec.agent : rec.data[f.key]) : "", ro, !rec)).join("") + (def.photo ? recPhotoHTML(ro) : "");
  state.editing.photo = null;
  if (def.photo) {
    setRecPhoto(null, rec ? "Chargement de la capture…" : null);
    if (rec?.photo_at) api(`records/${type}/${rec.id}/photo`).then((p) => { if (state.editing.id === rec.id && !state.editing.photo) setRecPhoto(p.data); })
      .catch(() => setRecPhoto(null, "Capture indisponible."));
    else if (rec) setRecPhoto(null, "Aucune capture enregistrée pour cette vente.");
  }
  $("#recordMeta").innerHTML = rec
    ? `Créé par <b>${esc(userName(rec.created_by))}</b> le ${dateTime(rec.created_at)}${rec.updated_at !== rec.created_at ? ` • modifié le ${dateTime(rec.updated_at)}` : ""}${rec.closed_at ? ` • comptabilisé dans le CA le ${dateTime(rec.closed_at)}` : ""}${ro ? "<br><i>Lecture seule : vous ne pouvez pas modifier ce dossier.</i>" : ""}`
    : "";
  $("#recordError").textContent = "";
  $$("#recordFields input[list=clientOptions]").forEach(updateBlacklistWarn);
  const catSel = $("#recordFields select[data-catalog]");
  if (catSel) updateCatalogPreview(catSel);
  const vIn = $("#recordFields input[data-vehicle]");
  if (vIn && vIn.value) showVehiclePreview(vIn);
  $("#recordSaveBtn").classList.toggle("hidden", ro);
  $("#recordSaveBtn").textContent = rec ? "Enregistrer les modifications" : "Enregistrer le dossier";
  $("#recordDeleteBtn").classList.toggle("hidden", !rec || !canDelete(type));
  openModal("recordModal");
  if (!ro) setTimeout(() => $("#recordFields input, #recordFields select")?.focus(), 40);
}

async function saveRecord(e) {
  e.preventDefault();
  const { type, id } = state.editing;
  const def = TYPES[type];
  const form = e.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  for (const f of def.fields) {
    if (f.type === "money") data[f.key] = data[f.key] === "" ? "" : Number(data[f.key]);
    if (f.required && (data[f.key] === "" || data[f.key] === undefined || (f.type === "money" && !data[f.key]))) {
      $("#recordError").textContent = `Le champ « ${f.label.replace(/ \(\$\)/, "")} » est obligatoire.`;
      form.querySelector(`[name="${f.key}"]`)?.focus();
      return;
    }
  }
  const partnerSel = form.querySelector("select[name=partenariat]");
  if (partnerSel) data.remise = Number(partnerSel.selectedOptions[0]?.dataset.remise) || 0;
  if (def.photo) {
    const rec = id ? (state.records[type] || []).find((x) => x.id === id) : null;
    if (!state.editing.photo && !rec?.photo_at) { $("#recordError").textContent = "Ajoutez la capture d'écran de la vente en jeu : elle est obligatoire."; return; }
    if (state.editing.photo) data.photo = state.editing.photo;
  }
  const btn = $("#recordSaveBtn");
  setBusy(btn, true, "Enregistrement…");
  try {
    if (id) await api(`records/${type}/${id}`, { method: "PUT", body: data });
    else await api(`records/${type}`, { method: "POST", body: data });
    closeModal("recordModal");
    toast(id ? "Dossier mis à jour." : "Dossier enregistré avec succès.");
    await loadAll();
  } catch (err) {
    $("#recordError").textContent = err.message;
  } finally {
    setBusy(btn, false);
  }
}

async function deleteRecord(type, id) {
  const rec = (state.records[type] || []).find((x) => x.id === id);
  if (!rec) return;
  const ok = await confirmDialog("Supprimer ce dossier ?", `« ${TYPES[type].title(rec.data)} » sera supprimé définitivement. ${rec.closed_at ? (type === "depenses" ? "Elle ne sera plus déduite du bénéfice." : "Son montant sera retiré du chiffre d'affaires.") : ""}`);
  if (!ok) return;
  try {
    await api(`records/${type}/${id}`, { method: "DELETE" });
    closeModal("recordModal");
    toast("Dossier supprimé.");
    await loadAll();
  } catch (e) { toast(e.message, "error"); }
}

/* ---------- chiffre d'affaires ---------- */

function renderCA() {
  const ca = state.ca;
  if (!ca) return;
  $("#caPeriod").textContent = ca.since ? `Période en cours depuis le ${dateTime(ca.since)}.` : "Période en cours depuis l'ouverture de l'intranet.";
  $("#caTotal").textContent = money(ca.total);
  $("#caCount").textContent = `${ca.count} opération${ca.count > 1 ? "s" : ""} comptabilisée${ca.count > 1 ? "s" : ""}`;
  $("#caVentes").textContent = money(ca.ventes);
  $("#caLocations").textContent = money(ca.locations);
  $("#caMine").textContent = money(ca.mine?.total);
  $("#caProgress").innerHTML = progressHTML(ca.total, ca.objectifs?.entreprise, true);
  $("#caMineProgress").innerHTML = progressHTML(ca.mine?.total, ca.objectifs?.employe);
  const hasProfit = ca.depenses !== undefined;
  $("#caProfit").classList.toggle("hidden", !hasProfit);
  if (hasProfit) {
    $("#caDepenses").textContent = money(ca.depenses);
    $("#caDepensesCount").textContent = `${ca.depensesCount} dépense${ca.depensesCount > 1 ? "s" : ""} enregistrée${ca.depensesCount > 1 ? "s" : ""}`;
    $("#caBenefice").textContent = money(ca.benefice);
    $("#caBenefice").classList.toggle("negative", ca.benefice < 0);
    const acc = ca.compte;
    $("#caSolde").textContent = acc ? money(acc.solde) : "Non défini";
    $("#caSolde").classList.toggle("negative", !!acc && acc.solde < 0);
    $("#caSoldeSub").textContent = acc
      ? `Départ ${money(acc.base)} le ${dateTime(acc.at)} • +${money(acc.entrees)} entrées • −${money(acc.sorties)} dépenses`
      : "Indiquez le montant actuel du compte pour partir sur la bonne base.";
    $("#soldeBtn").textContent = acc ? "Recaler le solde" : "Définir le solde";
    $("#soldeBtn").classList.toggle("hidden", !can("ca.cloturer"));
  }
  renderCAChart();

  const pay = ca.paie;
  $("#caMineSalary").innerHTML = pay ? myPayText(pay) : "";
  $("#caTeamPanel").classList.toggle("hidden", !pay);
  $("#caArchivesPanel").classList.toggle("hidden", !ca.archives);
  if (pay) renderPay(pay);
  if (!ca.archives) return;

  $("#caArchives").innerHTML = ca.archives.length ? ca.archives.map((a) => `
    <details class="archive">
      <summary><span><b>Du ${dateLabel(a.period_start)} au ${dateLabel(a.period_end)}</b><small>Clôturée par ${esc(userName(a.reset_by))} • ${a.details.count} opération(s)</small></span><strong>${money(a.total)}</strong></summary>
      <div class="archive-body">
        <p class="muted small">Ventes : ${money(a.details.ventes)}${a.details.depenses !== undefined ? ` • Dépenses : ${money(a.details.depenses)} • <b>Bénéfice : ${money(a.details.benefice)}</b>` : ""}</p>
        ${a.details.paie ? `<p class="muted small">${a.details.paie.best?.length ? `🏆 Meilleur vendeur : <b>${esc(a.details.paie.best.map(userName).join(" & "))}</b> (prime ${money(a.details.paie.prime)}) • ` : ""}Salaires et primes : <b>${money(a.details.paie.totalAVerser)}</b></p>` : ""}
        ${(a.details.employees || []).map((e) => { const p = a.details.paie?.rows?.find((x) => x.agent === e.agent); return `<div class="archive-row"><span>${esc(userName(e.agent))}${p?.prime ? " 🏆" : ""}</span><span>${e.count} op.</span><b>${money(e.total)}</b>${p ? `<span class="arch-pay">payé ${money(p.aVerser)}</span>` : ""}</div>`; }).join("") || `<p class="muted small">Aucune opération sur cette période.</p>`}
        ${can("ca.cloturer") ? `<button class="mini-btn danger" data-archive-delete="${a.id}">Supprimer cet historique</button>` : ""}
      </div>
    </details>`).join("") : `<div class="empty-state">Aucune semaine clôturée pour l'instant.${can("ca.cloturer") ? " Utilisez « Clôturer la semaine » pour archiver le CA et repartir à zéro." : ""}</div>`;
}

function myPayText(pay) {
  const m = pay.mine;
  if (!m) return "";
  if (!pay.objectif) return `<small class="pay-mine">Salaire : objectif par employé non défini</small>`;
  return `<small class="pay-mine">Salaire estimé : <b>${money(m.salaire)}</b>${m.best ? ` + prime <b>${money(pay.prime)}</b> 🏆` : ""}${m.rank ? ` • ${m.rank === 1 ? "1er" : m.rank + "e"} du classement` : ""}</small>`;
}
function renderPay(pay) {
  const mgr = pay.totalAVerser !== undefined;
  const bestRows = pay.classement.filter((r) => r.best);
  $("#caBest").innerHTML = bestRows.length
    ? `<div class="best-seller"><span class="trophy" aria-hidden="true">🏆</span><div><small>MEILLEUR VENDEUR DE LA SEMAINE</small><b>${esc(bestRows.map((r) => userName(r.agent)).join(" & "))}</b><span>${bestRows[0].count} vente${bestRows[0].count > 1 ? "s" : ""}${bestRows[0].total !== undefined ? ` • ${money(bestRows[0].total)} de CA` : ""} • prime de ${money(pay.prime)}${bestRows.length > 1 ? " chacun (égalité)" : ""}</span></div></div>`
    : `<div class="empty-state">Pas encore de vente cette semaine : le premier vendeur prend la tête du classement et la prime de ${money(pay.prime)}.</div>`;
  $("#caPayRule").innerHTML = pay.objectif
    ? `<b>Échelle de salaire</b> : ${money(pay.max)} × (CA du vendeur ÷ objectif de ${money(pay.objectif)}), plafonné à <b>${money(pay.max)}</b> quand l'objectif est atteint. Le meilleur vendeur de la semaine touche <b>${money(pay.prime)}</b> de prime en plus.
       <div class="pay-scale">${[25, 50, 75, 100].map((p) => `<span><small>${p} % de l'objectif</small>${money(pay.objectif * p / 100)} de CA<b>→ ${money(pay.max * p / 100)}</b></span>`).join("")}</div>`
    : `Définissez l'<b>objectif de CA par employé</b> (bouton « Objectifs ») pour calculer les salaires : l'atteindre donne le salaire maximum de <b>${money(pay.max)}</b>. Le meilleur vendeur touche <b>${money(pay.prime)}</b> de prime en plus.`;
  $("#caThead").innerHTML = `<tr><th>#</th><th>Employé</th><th class="num">Ventes</th><th class="num">CA</th>${mgr ? `<th class="num">Salaire</th><th class="num">Prime</th><th class="num">À verser</th>` : ""}</tr>`;
  $("#caTable").innerHTML = pay.classement.map((r) => {
    const u = state.users.find((x) => x.username === r.agent);
    const known = r.total !== undefined;
    return `<tr class="${r.agent === state.me.username ? "me" : ""}${r.best ? " best" : ""}">
      <td class="rank">${r.rank ? (r.best ? "🏆" : r.rank) : "–"}</td>
      <td><b>${esc(u?.display_name || r.agent)}</b><small>${esc(u?.grade || "")}</small>${known && pay.objectif ? `<div class="bar ${r.pct >= 100 ? "done" : ""}"><span style="width:${r.pct}%"></span></div><small>${r.pct} % de l'objectif</small>` : ""}</td>
      <td class="num">${r.count}</td><td class="num">${known ? money(r.total) : "—"}</td>
      ${mgr ? `<td class="num">${money(r.salaire)}</td><td class="num">${r.prime ? money(r.prime) : "—"}</td><td class="num total">${money(r.aVerser)}</td>` : ""}</tr>`;
  }).join("");
  $("#caPayTotals").classList.toggle("hidden", !mgr);
  if (mgr) $("#caPayTotals").innerHTML = `<div><span>Salaires</span><b>${money(pay.totalSalaires)}</b></div><div><span>Primes</span><b>${money(pay.totalPrimes)}</b></div><div class="total"><span>Total à verser</span><b>${money(pay.totalAVerser)}</b></div>`;
}

async function resetCA() {
  const ok = await confirmDialog("Clôturer la semaine ?", `Le CA actuel (${money(state.ca?.total)}) et le détail par employé seront archivés dans l'historique, puis les compteurs repartiront à zéro. Les dossiers ne sont pas supprimés.`, "Clôturer et remettre à zéro");
  if (!ok) return;
  try {
    await api("ca/reset", { method: "POST" });
    toast("Semaine clôturée. Le CA repart à zéro.");
    await loadAll();
  } catch (e) { toast(e.message, "error"); }
}

/* ---------- employés ---------- */

function renderUsers() {
  $("#usersDescription").textContent = can("employes.gerer") ? "Créez les comptes, changez les grades, réinitialisez les mots de passe." : "Liste de l'équipe. Votre grade ne permet pas de modifier les comptes.";
  $("#gradeLegend").innerHTML = can("grades.gerer") ? `<p class="hint">Les grades et leurs permissions se gèrent dans la page <a href="#grades" data-page="grades">Grades &amp; permissions</a>.</p>` : "";
  const caBy = Object.fromEntries((state.ca?.employees || []).map((e) => [e.agent, e.total]));
  $("#usersList").innerHTML = state.users.map((u) => {
    const self = u.username === state.me.username;
    return `<article class="record-card">
      <div class="record-main user-main"><div class="avatar">${esc((u.display_name || u.username).slice(0, 1).toUpperCase())}</div><div><div class="record-title"><b>${esc(u.display_name)}</b>${gradeTag(u.grade)}</div><p>${[(state.profiles?.[u.username]?.data?.telephone) && `☎ ${esc(state.profiles[u.username].data.telephone)}`, state.profiles?.[u.username]?.data?.embauche ? `embauché le ${esc(state.profiles[u.username].data.embauche)}` : `depuis le ${dateLabel(u.created_at)}`, `identifiant : ${esc(u.username)}`, state.profiles?.[u.username]?.photo_at && "🪪 carte RP"].filter(Boolean).join(" • ")}</p></div></div>
      <div class="record-meta"><span>CA semaine : <b>${money(caBy[u.username])}</b></span>
        <div class="record-actions"><button class="mini-btn" data-profile-open="${esc(u.username)}">Fiche</button>${self ? `<span class="you">Votre compte</span>` : can("employes.gerer") && (u.grade !== "Directeur" || isDirector()) ? `<button class="mini-btn" data-user-edit="${esc(u.username)}">Modifier</button><button class="mini-btn danger" data-user-delete="${esc(u.username)}">Supprimer</button>` : ""}</div>
      </div></article>`;
  }).join("") || `<div class="empty-state">Aucun employé.</div>`;
}

function openUser(username = null) {
  const u = username ? state.users.find((x) => x.username === username) : null;
  state.editingUser = u?.username || null;
  const f = $("#userForm");
  f.reset();
  $("#userModalTitle").textContent = u ? `Modifier ${u.display_name}` : "Créer un employé";
  $("#userSaveBtn").textContent = u ? "Enregistrer" : "Créer le compte";
  $("#userPwLabel").textContent = u ? "Nouveau mot de passe (optionnel)" : "Mot de passe";
  f.password.required = !u;
  f.password.placeholder = u ? "Laisser vide pour ne pas changer" : "8 caractères minimum";
  f.username.disabled = !!u;
  f.display_name.value = u?.display_name || "";
  f.username.value = u?.username || "";
  const options = state.grades.filter((g) => g.name !== "Directeur" || isDirector());
  if (u && !options.some((g) => g.name === u.grade)) options.push({ name: u.grade });
  f.grade.innerHTML = options.map((g) => `<option>${esc(g.name)}</option>`).join("");
  f.grade.value = u?.grade || (options.find((g) => g.name === "Vendeur") || options.find((g) => g.name === "Agent") || options[options.length - 1] || {}).name || "";
  f.grade.disabled = !!u && u.username === state.me.username;
  $("#userHint").textContent = u
    ? "Changer le mot de passe déconnecte l'employé de tous ses appareils."
    : "Communiquez l'identifiant et le mot de passe à l'employé : il pourra changer son mot de passe dans « Mon compte ».";
  $("#userError").textContent = "";
  openModal("userModal");
  setTimeout(() => f.display_name.focus(), 40);
}

async function saveUser(e) {
  e.preventDefault();
  const f = e.currentTarget;
  if (!f.reportValidity()) return;
  const body = { display_name: f.display_name.value.trim(), grade: f.grade.value };
  if (f.password.value) body.password = f.password.value;
  const btn = $("#userSaveBtn");
  setBusy(btn, true, "Enregistrement…");
  try {
    if (state.editingUser) await api(`users/${encodeURIComponent(state.editingUser)}`, { method: "PATCH", body });
    else await api("users", { method: "POST", body: { ...body, username: f.username.value.trim() } });
    closeModal("userModal");
    toast(state.editingUser ? "Compte mis à jour." : "Compte employé créé.");
    await loadAll();
  } catch (err) {
    $("#userError").textContent = err.message;
  } finally { setBusy(btn, false); }
}

async function deleteUser(username) {
  const ok = await confirmDialog("Supprimer ce compte ?", `Le compte de ${userName(username)} sera supprimé et ne pourra plus se connecter. Ses dossiers et son CA restent enregistrés.`);
  if (!ok) return;
  try {
    await api(`users/${encodeURIComponent(username)}`, { method: "DELETE" });
    toast("Compte supprimé.");
    await loadAll();
  } catch (err) { toast(err.message, "error"); }
}

/* ---------- catalogue des biens ---------- */

function renderCatalog() {
  const occ = state.page === "occasions";
  state.catFilter = occ ? "Occasion" : "Neuf";
  $("#catalogTitle").textContent = occ ? "Occasions" : "Véhicules neufs";
  $("#catalogKicker").textContent = occ ? "VITRINE PUBLIQUE" : "TARIFS DE LA CONCESSION";
  $("#addCatalogBtn").textContent = occ ? "＋ Nouvelle occasion" : "＋ Nouveau véhicule neuf";
  $("#addCatalogBtn").classList.toggle("hidden", !can("catalogue.gerer"));
  $("#vitrineBtn").classList.toggle("hidden", !can("catalogue.gerer"));
  $("#catalogDescription").textContent = can("catalogue.gerer")
    ? (occ ? "Les occasions cochées « vitrine » apparaissent sur le site public avec leur photo, leur prix et leurs informations. Elles sont aussi proposées dans les ventes."
           : "Liste des prix des véhicules neufs : ils se remplissent automatiquement quand on enregistre une vente.")
    : (occ ? "Occasions en stock. Votre grade ne permet pas de les modifier." : "Prix officiels de la concession. Votre grade ne permet pas de les modifier.");
  const counts = {};
  state.catalog.forEach((c) => (counts[catOf(c)] = (counts[catOf(c)] || 0) + 1));
  const cats = [...CATEGORIES, ...(counts["Non classé"] ? ["Non classé"] : [])];
  if (state.catFilter !== "all" && !cats.includes(state.catFilter)) state.catFilter = "all";
  $("#catalogTabs").innerHTML = [["all", `Tous (${state.catalog.length})`], ...cats.map((c) => [c, `${c} (${counts[c] || 0})`])]
    .map(([v, l]) => `<button class="chip ${state.catFilter === v ? "active" : ""}" data-cat-filter="${esc(v)}">${esc(l)}</button>`).join("");
  const card = (c) => `
    <article class="record-card">
      <div class="record-main user-main"><div class="cat-thumb" ${c.photo_at ? `data-view-photo="${c.id}:${c.photo_at}" data-photo-title="${esc(c.nom)}" title="Agrandir"` : ""}>${c.photo_at ? `<img data-photo="${c.id}:${c.photo_at}" alt="">` : "<span>❖</span>"}</div><div><div class="record-title"><b>${esc(c.nom)}</b><span class="badge">${esc(catOf(c))}</span>${c.categorie === "Occasion" ? (c.public === 0 ? `<span class="badge bad">Masquée de la vitrine</span>` : `<span class="badge ok">En vitrine</span>`) : ""}</div>
        <p>Prix : <b>${money(c.prix_vente)}</b>${c.description ? ` • ${esc(c.description)}` : ""}</p></div></div>
      <div class="record-meta"><div class="record-actions">${can("catalogue.gerer") ? `<button class="mini-btn" data-cat-edit="${c.id}">Modifier</button><button class="mini-btn danger" data-cat-delete="${c.id}">Supprimer</button>` : ""}</div></div>
    </article>`;
  const shown = state.catFilter === "all" ? cats : [state.catFilter];
  const html = shown.map((cat) => {
    const group = state.catalog.filter((c) => catOf(c) === cat);
    if (!group.length) return state.catFilter === "all" ? "" : `<div class="empty-state">Aucun bien dans « ${esc(cat)} » pour l'instant.</div>`;
    return `${state.catFilter === "all" ? `<h4 class="cat-heading">${esc(cat)} <span>${group.length}</span></h4>` : ""}${group.map(card).join("")}`;
  }).join("");
  $("#catalogTabs").innerHTML = "";
  const list = state.catalog.filter((c) => catOf(c) === state.catFilter);
  $("#catalogList").innerHTML = list.length ? list.map(card).join("") : `<div class="empty-state">${occ ? "Aucune occasion en stock." : "Aucun véhicule neuf pour l'instant."}${can("catalogue.gerer") ? ` Cliquez sur « ${occ ? "Nouvelle occasion" : "Nouveau véhicule neuf"} » pour en ajouter.` : ""}</div>`;
  fillPhotos($("#catalogList"));
}

/* ---------- photos ---------- */

const photoCache = {};
function loadPhoto(key) {
  if (!photoCache[key]) {
    const id = key.split(":")[0];
    photoCache[key] = api(`catalog/${id}/photo`).then((r) => r.data).catch(() => { delete photoCache[key]; return null; });
  }
  return photoCache[key];
}
function fillPhotos(root) {
  root.querySelectorAll("img[data-photo]").forEach(async (img) => {
    const data = await loadPhoto(img.dataset.photo);
    if (data && img.isConnected) img.src = data;
  });
}
async function updateCatalogPreview(sel) {
  const img = sel.parentElement.querySelector("[data-cat-preview]");
  if (!img) return;
  const key = sel.selectedOptions[0]?.dataset.photo;
  img.classList.add("hidden");
  img.removeAttribute("src");
  delete img.dataset.viewPhoto;
  if (!key) return;
  const data = await loadPhoto(key);
  if (data && sel.selectedOptions[0]?.dataset.photo === key) {
    img.src = data;
    img.dataset.viewPhoto = key;
    img.dataset.photoTitle = sel.value;
    img.classList.remove("hidden");
  }
}
async function viewPhoto(key, title) {
  const data = await loadPhoto(key);
  if (!data) return toast("Photo indisponible.", "error");
  $("#photoFull").src = data;
  $("#photoFull").classList.remove("hidden");
  $("#photoTitle").textContent = title || "";
  $("#photoInfo").classList.add("hidden");
  openModal("photoModal");
}
function recPhotoHTML(ro) {
  return `<div class="full-field photo-field"><span class="photo-label">Capture de la vente en jeu ${ro ? "" : '<i class="req">*</i>'}</span>
    <div class="photo-box id-box"><img id="recPhotoPreview" alt="Capture de la vente" class="hidden"><span id="recPhotoEmpty">Ajoutez une capture d'écran de la facturation faite en jeu.</span></div>
    ${ro ? "" : `<div class="photo-actions"><label class="btn btn-quiet file-btn">📷 <span id="recPhotoBtnLabel">Ajouter la capture</span><input type="file" id="recPhotoInput" accept="image/jpeg,image/png,image/webp" hidden></label></div>
    <small class="muted small">Obligatoire : sans capture, la vente ne peut pas être enregistrée.</small>`}</div>`;
}
function setRecPhoto(data, msg) {
  const img = $("#recPhotoPreview");
  if (!img) return;
  if (data) { img.src = data; img.classList.remove("hidden"); } else { img.removeAttribute("src"); img.classList.add("hidden"); }
  $("#recPhotoEmpty").classList.toggle("hidden", !!data);
  if (msg) $("#recPhotoEmpty").textContent = msg;
  const lbl = $("#recPhotoBtnLabel");
  if (lbl) lbl.textContent = data ? "Remplacer la capture" : "Ajouter la capture";
}
function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error("Choisissez une image JPG, PNG ou WEBP."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire ce fichier."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Impossible de lire cette image."));
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        const max = 1400;
        if (Math.max(w, h) > max) { const r = max / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        let q = 0.85, out = cv.toDataURL("image/jpeg", q);
        while (out.length > 1400000 && q > 0.45) { q -= 0.1; out = cv.toDataURL("image/jpeg", q); }
        if (out.length > 1400000) reject(new Error("Photo trop lourde, choisissez une image plus petite."));
        else resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function setCatalogPreview(data) {
  const img = $("#catalogPhotoPreview");
  if (data) { img.src = data; img.classList.remove("hidden"); } else { img.removeAttribute("src"); img.classList.add("hidden"); }
  $("#catalogPhotoEmpty").classList.toggle("hidden", !!data);
  $("#catalogPhotoRemove").classList.toggle("hidden", !data);
}

function syncCatalogForm() {
  const f = $("#catalogForm");
  const occ = f.categorie.value === "Occasion";
  $("#catalogPublicLine").classList.toggle("hidden", !occ);
  $("#catalogDescLabel").textContent = occ ? "Informations (affichées sur la vitrine)" : "Informations (facultatif)";
}
function vehicleOf(name) {
  const n = String(name || "").trim().toLowerCase();
  return n ? state.catalog.find((c) => c.nom.trim().toLowerCase() === n && c.prix_vente > 0) : null;
}
async function showVehiclePreview(input) {
  const img = input.parentElement.querySelector("[data-cat-preview]");
  if (!img) return;
  const c = vehicleOf(input.value);
  img.classList.add("hidden"); img.removeAttribute("src"); delete img.dataset.viewPhoto;
  if (!c?.photo_at) return;
  const key = `${c.id}:${c.photo_at}`;
  const data = await loadPhoto(key);
  if (data && vehicleOf(input.value) === c) { img.src = data; img.dataset.viewPhoto = key; img.dataset.photoTitle = c.nom; img.classList.remove("hidden"); }
}
function onVehicleInput(input) {
  const form = input.form;
  const c = vehicleOf(input.value);
  const hint = input.parentElement.querySelector("[data-vehicle-hint]");
  if (c) {
    const base = form.querySelector("[name=prix_base]");
    if (base) { base.value = c.prix_vente; base.dispatchEvent(new Event("input", { bubbles: true })); }
    recalcSale(form);
    if (hint) hint.textContent = `Prix ${c.categorie === "Occasion" ? "de l'occasion" : "catalogue"} : ${money(c.prix_vente)} (modifiable).`;
  } else if (hint && input.value.trim()) hint.textContent = "Modèle hors liste : indiquez le prix à la main.";
  showVehiclePreview(input);
}
function openCatalog(id = null) {
  const c = id ? state.catalog.find((x) => x.id === id) : null;
  state.editingCatalog = c?.id || null;
  const f = $("#catalogForm");
  f.reset();
  $("#catalogModalTitle").textContent = c ? `Modifier ${c.nom}` : (state.page === "occasions" ? "Nouvelle occasion" : "Nouveau véhicule neuf");
  f.nom.value = c?.nom || "";
  f.public.checked = !c || c.public !== 0;
  f.categorie.value = c && CATEGORIES.includes(c.categorie) ? c.categorie : (CATEGORIES.includes(state.catFilter) ? state.catFilter : "Neuf");
  f.prix_vente.value = c?.prix_vente || "";
  f.description.value = c?.description || "";
  syncCatalogForm();
  $("#catalogPhotoInput").value = "";
  state.catalogPhoto = { changed: false, data: null, had: !!c?.photo_at };
  setCatalogPreview(null);
  if (c?.photo_at) {
    const key = `${c.id}:${c.photo_at}`;
    loadPhoto(key).then((d) => { if (state.editingCatalog === c.id && !state.catalogPhoto.changed) setCatalogPreview(d); });
  }
  $("#catalogError").textContent = "";
  openModal("catalogModal");
  setTimeout(() => f.nom.focus(), 40);
}

async function saveCatalog(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const body = { nom: f.nom.value.trim(), categorie: f.categorie.value, public: f.public.checked, prix_vente: f.prix_vente.value ? Number(f.prix_vente.value) : 0, description: f.description.value.trim() };
  const btn = f.querySelector("button[type=submit]");
  setBusy(btn, true, "Enregistrement…");
  try {
    let id = state.editingCatalog;
    if (id) await api(`catalog/${id}`, { method: "PUT", body });
    else id = (await api("catalog", { method: "POST", body })).id;
    const ph = state.catalogPhoto;
    if (ph.changed && ph.data) await api(`catalog/${id}/photo`, { method: "PUT", body: { data: ph.data } });
    else if (ph.changed && ph.had) await api(`catalog/${id}/photo`, { method: "DELETE" });
    closeModal("catalogModal");
    toast("Véhicule enregistré.");
    await loadAll();
  } catch (err) { $("#catalogError").textContent = err.message; }
  finally { setBusy(btn, false); }
}

async function deleteCatalog(id) {
  const c = state.catalog.find((x) => x.id === id);
  if (!c || !(await confirmDialog("Retirer ce véhicule ?", `« ${c.nom} » ne sera plus proposé dans les ventes${c.categorie === "Occasion" ? " ni sur la vitrine" : ""}. Les ventes déjà enregistrées ne changent pas.`))) return;
  try { await api(`catalog/${id}`, { method: "DELETE" }); toast("Véhicule retiré."); await loadAll(); }
  catch (err) { toast(err.message, "error"); }
}

/* ---------- objectifs ---------- */

function progressHTML(value, goal, big = false) {
  if (!goal) return "";
  const pct = Math.round(((value || 0) / goal) * 100);
  return `<div class="progress ${big ? "big" : ""} ${pct >= 100 ? "done" : ""}"><span style="width:${Math.min(100, pct)}%"></span></div>
    <small class="progress-label">${pct >= 100 ? "🎯 Objectif atteint" : `${pct} % de l'objectif`} • ${money(goal)}</small>`;
}

function openSolde() {
  const f = $("#soldeForm");
  f.montant.value = state.ca?.compte ? state.ca.compte.solde : "";
  $("#soldeError").textContent = "";
  openModal("soldeModal");
  setTimeout(() => f.montant.select(), 40);
}

async function saveSolde(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const btn = f.querySelector("button[type=submit]");
  setBusy(btn, true, "Enregistrement…");
  try {
    await api("ca/solde", { method: "POST", body: { montant: Number(f.montant.value) } });
    closeModal("soldeModal");
    toast("Solde du compte enregistré.");
    await loadAll();
  } catch (err) { $("#soldeError").textContent = err.message; }
  finally { setBusy(btn, false); }
}

function openObjectives() {
  const f = $("#objectivesForm");
  f.entreprise.value = state.ca?.objectifs?.entreprise || "";
  f.employe.value = state.ca?.objectifs?.employe || "";
  f.salaire_max.value = state.ca?.paie?.max ?? 250000;
  f.prime_meilleur.value = state.ca?.paie?.prime ?? 50000;
  $("#objectivesError").textContent = "";
  openModal("objectivesModal");
  setTimeout(() => f.entreprise.focus(), 40);
}

async function saveObjectives(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const btn = f.querySelector("button[type=submit]");
  setBusy(btn, true, "Enregistrement…");
  try {
    await api("ca/objectifs", { method: "POST", body: { entreprise: Number(f.entreprise.value) || 0, employe: Number(f.employe.value) || 0, salaire_max: Number(f.salaire_max.value) || 0, prime_meilleur: Number(f.prime_meilleur.value) || 0 } });
    closeModal("objectivesModal");
    toast("Objectifs enregistrés.");
    await loadAll();
  } catch (err) { $("#objectivesError").textContent = err.message; }
  finally { setBusy(btn, false); }
}

/* ---------- graphique du CA ---------- */

function renderCAChart() {
  const ca = state.ca;
  const panel = $("#caChartPanel");
  if (!ca.archives) { panel.classList.add("hidden"); return; }
  const weeks = ca.archives.slice(0, 11).reverse().map((a) => ({ label: dateLabel(a.period_end).replace(/ \d{4}$/, ""), value: a.total, tip: `Du ${dateLabel(a.period_start)} au ${dateLabel(a.period_end)}`, benefice: a.details?.benefice }));
  weeks.push({ label: "En cours", value: ca.total, tip: "Semaine en cours", current: true, benefice: ca.benefice });
  panel.classList.remove("hidden");
  if (weeks.length < 2) {
    $("#caChart").innerHTML = `<div class="empty-state">Le graphique apparaîtra après la première clôture de semaine.</div>`;
    return;
  }
  const W = 760, H = 240, padL = 8, padR = 8, padT = 22, padB = 30;
  const max = Math.max(1, ...weeks.map((w) => w.value), ca.objectifs?.entreprise || 0);
  const step = (W - padL - padR) / weeks.length;
  const bw = Math.min(46, step * 0.62);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const grid = [0.25, 0.5, 0.75, 1].map((f) => `<line x1="${padL}" x2="${W - padR}" y1="${y(max * f)}" y2="${y(max * f)}" class="grid"/>`).join("");
  const best = weeks.reduce((m, w, i) => (w.value > weeks[m].value ? i : m), 0);
  const bars = weeks.map((w, i) => {
    const x = padL + step * i + (step - bw) / 2;
    const top = y(w.value), h = Math.max(0, H - padB - top);
    const r = Math.min(4, h);
    const path = h > 0 ? `M${x},${H - padB} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${H - padB} Z` : "";
    const showLabel = i === best || w.current;
    return `<g class="bar-g ${w.current ? "current" : ""}" data-tip="${esc(`${w.tip} : ${money(w.value)}${w.benefice !== undefined ? ` • bénéfice ${money(w.benefice)}` : ""}`)}">
      <rect x="${padL + step * i}" y="${padT}" width="${step}" height="${H - padT - padB}" class="hit"/>
      ${path ? `<path d="${path}" class="bar-mark"/>` : ""}
      ${showLabel ? `<text x="${x + bw / 2}" y="${top - 7}" class="val">${esc(shortMoney(w.value))}</text>` : ""}
      <text x="${x + bw / 2}" y="${H - 10}" class="lbl">${esc(w.label)}</text></g>`;
  }).join("");
  const goal = ca.objectifs?.entreprise ? `<line x1="${padL}" x2="${W - padR}" y1="${y(ca.objectifs.entreprise)}" y2="${y(ca.objectifs.entreprise)}" class="goal"/><text x="${W - padR}" y="${y(ca.objectifs.entreprise) - 5}" class="goal-lbl">Objectif ${esc(shortMoney(ca.objectifs.entreprise))}</text>` : "";
  $("#caChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="ca-chart" role="img" aria-label="CA par semaine">${grid}<line x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}" class="axis"/>${goal}${bars}</svg><div class="chart-tip hidden" id="chartTip"></div>`;
}
const shortMoney = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M $` : n >= 1e3 ? `${Math.round(n / 1e3)} k $` : money(n));

document.addEventListener("mousemove", (e) => {
  const tip = $("#chartTip");
  if (!tip) return;
  const g = e.target.closest?.(".bar-g");
  if (!g) { tip.classList.add("hidden"); $$(".bar-g.hover").forEach((x) => x.classList.remove("hover")); return; }
  $$(".bar-g.hover").forEach((x) => x !== g && x.classList.remove("hover"));
  g.classList.add("hover");
  const box = $("#caChart").getBoundingClientRect();
  tip.textContent = g.dataset.tip;
  tip.classList.remove("hidden");
  const tx = Math.min(box.width - tip.offsetWidth - 4, Math.max(4, e.clientX - box.left + 12));
  tip.style.left = `${tx}px`;
  tip.style.top = `${Math.max(0, e.clientY - box.top - 40)}px`;
});

/* ---------- fiche client ---------- */

function openClient(id) {
  const c = (state.records.clients || []).find((x) => x.id === id);
  if (!c) return toast("Ce client n'existe plus.", "error");
  const n = String(c.data.nom || "").trim().toLowerCase();
  const hist = [
    ...(state.records.ventes || []).filter((x) => (x.data.client || "").trim().toLowerCase() === n).map((x) => ({ ...x, type: "ventes" })),
    ...(state.records.locations || []).filter((x) => (x.data.locataire || "").trim().toLowerCase() === n).map((x) => ({ ...x, type: "locations" })),
  ].sort((a, b) => b.created_at - a.created_at);
  const total = hist.reduce((s, x) => s + (x.amount || 0), 0);
  const nv = hist.filter((x) => x.type === "ventes").length, nl = hist.length - nv;
  $("#clientName").textContent = c.data.nom;
  $("#clientBody").innerHTML = `
    ${c.data.liste_noire ? `<p class="bl-banner">⚠ Client sur liste noire${c.data.motif ? ` : ${esc(c.data.motif)}` : ""}</p>` : ""}
    <p class="client-info">${[c.data.telephone && `☎ ${esc(c.data.telephone)}`, c.data.employeur && `Employeur / groupe : <b>${esc(c.data.employeur)}</b>`].filter(Boolean).join(" • ") || "Aucune coordonnée enregistrée."}</p>
    <div class="client-stats">
      <div><span>Total dépensé</span><b>${money(total)}</b></div>
      <div><span>Achats</span><b>${nv}</b></div>
      <div><span>Client depuis</span><b>${dateLabel(c.created_at)}</b></div>
    </div>
    <p class="section-kicker">HISTORIQUE</p>
    <div class="client-history">${hist.length ? hist.map((x) => `
      <button class="recent-item" data-client-open="${x.type}:${x.id}">
        <div><b>${esc(TYPES.ventes.title(x.data))}</b><small>${x.data.plaque ? `Plaque ${esc(x.data.plaque)}` : "Achat"} • ${esc(userName(x.agent))} • ${dateLabel(x.created_at)}</small></div>
        <span class="recent-right"><span class="amount-sm">${money(x.amount)}</span><span class="badge">${x.type === "ventes" ? "achat" : "location"}</span></span>
      </button>`).join("") : `<div class="empty-state">Aucun achat pour ce client. Les dossiers sont reliés par le nom exact du client.</div>`}</div>`;
  $("#clientEditBtn").textContent = canEdit(c, "clients") ? "Modifier la fiche" : "Voir la fiche";
  $("#clientEditBtn").onclick = () => { closeModal("clientModal"); openRecord("clients", c.id); };
  openModal("clientModal");
}

/* ---------- journal d'activité ---------- */

const ACTION_CLASS = { "création": "ok", "modification": "pending", "suppression": "bad", "clôture": "done" };
async function loadJournal(more = false) {
  try {
    const before = more && state.logs?.length ? state.logs[state.logs.length - 1].id : "";
    const rows = await api(`logs${before ? `?before=${before}` : ""}`);
    state.logs = more ? [...(state.logs || []), ...rows] : rows;
    state.logsEnd = rows.length < 100;
    renderJournal();
  } catch (e) { toast(e.message, "error"); }
}
function renderJournal() {
  if (!state.logs) { $("#journalList").innerHTML = `<div class="empty-state">Chargement…</div>`; loadJournal(); return; }
  const who = $("#journalUser").value, what = $("#journalType").value, q = $("#journalSearch").value.trim().toLowerCase();
  const users = [...new Set(state.logs.map((l) => l.username))];
  const types = [...new Set(state.logs.map((l) => l.type))].sort();
  const keep = (sel, vals, label) => { const v = sel.value; sel.innerHTML = `<option value="">${label}</option>` + vals.map((x) => `<option value="${esc(x)}">${esc(sel.id === "journalUser" ? userName(x) : x)}</option>`).join(""); sel.value = vals.includes(v) ? v : ""; };
  keep($("#journalUser"), users, "Tous les employés");
  keep($("#journalType"), types, "Tous les types");
  const rows = state.logs.filter((l) => (!who || l.username === who) && (!what || l.type === what) && (!q || `${l.label} ${l.details} ${l.action}`.toLowerCase().includes(q)));
  $("#journalList").innerHTML = rows.length ? rows.map((l) => `
    <div class="log-row">
      <span class="log-time">${dateTime(l.at)}</span>
      <span class="badge ${ACTION_CLASS[l.action] || ""}">${esc(l.action)}</span>
      <div class="log-main"><b>${esc(userName(l.username))}</b> · ${esc(l.type)} « ${esc(l.label)} »${l.details ? `<small>${esc(l.details)}</small>` : ""}</div>
    </div>`).join("") : `<div class="empty-state">Aucune action enregistrée${who || what || q ? " pour ces filtres" : ""}.</div>`;
  $("#journalMore").classList.toggle("hidden", !!state.logsEnd);
}

/* ---------- grades & permissions ---------- */

function renderGrades() {
  $("#gradesList").innerHTML = state.grades.map((g, i) => {
    const locked = g.name === "Directeur";
    const perms = locked ? `<span class="perm-chip all">Tous les droits</span>` : g.permissions.length
      ? g.permissions.map((p) => `<span class="perm-chip">${esc(PERM_LABEL[p] || p)}</span>`).join("")
      : `<span class="perm-chip none">Consultation uniquement</span>`;
    const first = i === 1, last = i === state.grades.length - 1;
    return `<article class="record-card grade-card">
      <div class="record-main"><div class="record-title">${gradeTag(g.name)}<small class="muted">${g.users} employé${g.users > 1 ? "s" : ""}</small></div><div class="perm-chips">${perms}</div></div>
      <div class="record-meta"><div class="record-actions">${locked ? `<span class="you">Non modifiable</span>` : `
        <button class="mini-btn" data-grade-move="${esc(g.name)}" data-dir="-1" ${first ? "disabled" : ""} title="Monter">↑</button>
        <button class="mini-btn" data-grade-move="${esc(g.name)}" data-dir="1" ${last ? "disabled" : ""} title="Descendre">↓</button>
        <button class="mini-btn" data-grade-edit="${esc(g.name)}">Modifier</button>
        <button class="mini-btn danger" data-grade-delete="${esc(g.name)}">Supprimer</button>`}</div></div>
    </article>`;
  }).join("") || `<div class="empty-state">Aucun grade.</div>`;
}

function openGrade(name = null) {
  const g = name ? state.grades.find((x) => x.name === name) : null;
  state.editingGrade = g?.name || null;
  const f = $("#gradeForm");
  f.reset();
  $("#gradeModalTitle").textContent = g ? `Modifier « ${g.name} »` : "Nouveau grade";
  f.name.value = g?.name || "";
  $("#gradePerms").innerHTML = PERMS.map(([k, l, d]) => `
    <label class="perm-option"><input type="checkbox" name="perm" value="${k}" ${g?.permissions.includes(k) ? "checked" : ""}><span><b>${esc(l)}</b><small>${esc(d)}</small></span></label>`).join("");
  $("#gradeError").textContent = "";
  openModal("gradeModal");
  setTimeout(() => f.name.focus(), 40);
}

async function saveGrade(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const body = { name: f.name.value.trim(), permissions: [...f.querySelectorAll("[name=perm]:checked")].map((c) => c.value) };
  const btn = f.querySelector("button[type=submit]");
  setBusy(btn, true, "Enregistrement…");
  try {
    if (state.editingGrade) await api(`grades/${encodeURIComponent(state.editingGrade)}`, { method: "PUT", body });
    else await api("grades", { method: "POST", body });
    closeModal("gradeModal");
    toast("Grade enregistré.");
    await loadAll();
  } catch (err) { $("#gradeError").textContent = err.message; }
  finally { setBusy(btn, false); }
}

async function deleteGrade(name) {
  if (!(await confirmDialog("Supprimer ce grade ?", `Le grade « ${name} » sera supprimé. Il ne doit plus être attribué à aucun employé.`))) return;
  try { await api(`grades/${encodeURIComponent(name)}`, { method: "DELETE" }); toast("Grade supprimé."); await loadAll(); }
  catch (err) { toast(err.message, "error"); }
}

/* ---------- fiche employé ---------- */

function openProfile(username) {
  if (username === "me") username = state.me.username;
  const u = state.users.find((x) => x.username === username);
  if (!u) return;
  const p = state.profiles?.[username] || { data: {} };
  const mine = username === state.me.username;
  const manager = can("employes.gerer") && (u.grade !== "Directeur" || isDirector() || mine);
  const editable = mine || manager;
  state.editingProfile = { username, editable, idChanged: false, idData: null, hadId: !!p.photo_at };
  const f = $("#profileForm");
  f.reset();
  ["naissance", "telephone", "embauche", "adresse", "notes"].forEach((k) => { f[k].value = p.data?.[k] || ""; f[k].disabled = !editable || (k === "notes" && !can("employes.gerer")); });
  $("#profileNotesField").classList.toggle("hidden", !can("employes.gerer"));
  $("#idPhotoField").classList.toggle("hidden", !(mine || can("employes.gerer")));
  $("#profileTitle").textContent = u.display_name;
  $("#profileSub").innerHTML = `${gradeTag(u.grade)} • identifiant ${esc(u.username)}${mine ? " • votre fiche" : ""}`;
  $("#profileSaveBtn").classList.toggle("hidden", !editable);
  $(".id-box").parentElement.querySelector(".photo-actions").classList.toggle("hidden", !editable);
  $("#profileError").textContent = "";
  setIdPreview(null);
  if (p.photo_at && (mine || can("employes.gerer"))) {
    api(`profiles/${encodeURIComponent(username)}/photo`).then((r) => { if (state.editingProfile?.username === username && !state.editingProfile.idChanged) setIdPreview(r.data); }).catch(() => {});
  }
  openModal("profileModal");
}

function setIdPreview(data) {
  const img = $("#idPhotoPreview");
  if (data) { img.src = data; img.classList.remove("hidden"); } else { img.removeAttribute("src"); img.classList.add("hidden"); }
  $("#idPhotoEmpty").classList.toggle("hidden", !!data);
  $("#idPhotoRemove").classList.toggle("hidden", !data || !state.editingProfile?.editable);
}

async function saveProfile(e) {
  e.preventDefault();
  const st = state.editingProfile;
  if (!st?.editable) return;
  const f = e.currentTarget, btn = $("#profileSaveBtn");
  const body = Object.fromEntries(["naissance", "telephone", "embauche", "adresse", "notes"].map((k) => [k, f[k].value]));
  setBusy(btn, true, "Enregistrement…");
  try {
    const path = `profiles/${encodeURIComponent(st.username)}`;
    await api(path, { method: "PUT", body });
    if (st.idChanged && st.idData) await api(`${path}/photo`, { method: "PUT", body: { data: st.idData } });
    else if (st.idChanged && st.hadId) await api(`${path}/photo`, { method: "DELETE" });
    closeModal("profileModal");
    toast("Fiche enregistrée.");
    await loadAll();
  } catch (err) { $("#profileError").textContent = err.message; }
  finally { setBusy(btn, false); }
}

/* ---------- mon compte ---------- */

// Fond d'écran unique : hall en marbre
function applyBackground() {
  document.body.dataset.bg = "lobby";
}

function renderAccount() {
  applyBackground();
  $("#accName").textContent = state.me.display_name;
  $("#accUser").textContent = state.me.username;
  $("#accGrade").innerHTML = gradeTag(state.me.grade);
  $("#accRights").innerHTML = isDirector() ? "Tous les droits." : (state.me.permissions || []).length
    ? `<ul class="rights-list">${state.me.permissions.map((p) => `<li>${esc(PERM_LABEL[p] || p)}</li>`).join("")}</ul>`
    : "Consultation uniquement.";
}

async function changePassword(e) {
  e.preventDefault();
  const f = e.currentTarget;
  $("#passwordError").textContent = "";
  if (f.next.value !== f.confirm.value) { $("#passwordError").textContent = "Les deux nouveaux mots de passe ne correspondent pas."; return; }
  const btn = f.querySelector("button[type=submit]");
  setBusy(btn, true);
  try {
    await api("me/password", { method: "POST", body: { current: f.current.value, next: f.next.value } });
    f.reset();
    toast("Mot de passe mis à jour.");
  } catch (err) { $("#passwordError").textContent = err.message; }
  finally { setBusy(btn, false); }
}

/* ---------- connexion ---------- */

async function login(e) {
  e.preventDefault();
  $("#loginError").textContent = "";
  const btn = e.currentTarget.querySelector("button[type=submit]");
  setBusy(btn, true, "Connexion…");
  try {
    const data = await api("login", { method: "POST", body: { username: $("#username").value, password: $("#password").value } });
    saveToken(data.token);
    state.me = data.user;
    $("#password").value = "";
    await enterApp();
  } catch (err) {
    $("#loginError").textContent = err.message;
  } finally { setBusy(btn, false); }
}

async function setup(e) {
  e.preventDefault();
  const f = e.currentTarget;
  $("#setupError").textContent = "";
  if (f.password.value !== f.confirm.value) { $("#setupError").textContent = "Les deux mots de passe ne correspondent pas."; return; }
  const btn = f.querySelector("button[type=submit]");
  setBusy(btn, true, "Création…");
  try {
    const data = await api("setup", { method: "POST", body: { display_name: f.display_name.value, username: f.username.value, password: f.password.value } });
    saveToken(data.token);
    state.me = data.user;
    f.reset();
    await enterApp();
    toast("Compte Directeur créé. Bienvenue !");
  } catch (err) { $("#setupError").textContent = err.message; }
  finally { setBusy(btn, false); }
}

async function logout() {
  try { await api("logout", { method: "POST" }); } catch { /* ignore */ }
  saveToken("");
  state.me = null;
  state.records = {}; state.users = []; state.ca = null;
  closeAllModals();
  showLogin(false);
}

async function boot() {
  if (new URLSearchParams(location.search).has("vitrine")) {
    history.replaceState(null, "", location.pathname);
    if (state.token) { try { state.me = await api("me"); await enterApp(); } catch { saveToken(""); state.me = null; } }
    return showPublic(!!state.me);
  }
  if (state.token) {
    try {
      state.me = await api("me");
      await enterApp();
      return;
    } catch { saveToken(""); state.me = null; }
  }
  try {
    const { needsSetup } = await api("setup");
    if (needsSetup) return showLogin(true);
    const h = location.hash.slice(1);
    if (h === "espace" || ["dashboard", "ca", "account", "catalog", "occasions", "users", "grades", "journal", ...Object.keys(TYPES)].includes(h)) showLogin(false);
    else showPublic();
  } catch (e) {
    showLogin(false, e.message);
  }
}

/* ---------- demandes reçues ---------- */

const REQ_STATUS = { rdv: ["Nouvelle", "Prise en charge", "Traitée", "Annulée"], candidature: ["Nouvelle", "Entretien prévu", "Acceptée", "Refusée"] };
const REQ_OPEN = ["Nouvelle", "Prise en charge", "Entretien prévu"];
const REQ_CLASS = { "Nouvelle": "pending", "Prise en charge": "ok", "Entretien prévu": "ok", "Traitée": "done", "Acceptée": "done", "Annulée": "bad", "Refusée": "bad" };

function updateRequestsBadge() {
  const n = (state.requests || []).filter((r) => r.statut === "Nouvelle").length;
  $("#requestsBadge").textContent = n;
  $("#requestsBadge").classList.toggle("hidden", !n);
}

function renderRequests() {
  const kinds = [["rdv", "Rendez-vous", "rdv.gerer"], ["candidature", "Candidatures", "recrutement.gerer"]].filter((k) => can(k[2]));
  if (!kinds.some((k) => k[0] === state.reqKind)) state.reqKind = kinds[0]?.[0] || "rdv";
  const all = (state.requests || []).filter((r) => r.kind === state.reqKind);
  const newCount = (k) => (state.requests || []).filter((r) => r.kind === k && r.statut === "Nouvelle").length;
  $("#reqKinds").innerHTML = kinds.map(([k, l]) => `<button class="chip ${state.reqKind === k ? "active" : ""}" data-req-kind="${k}">${l}${newCount(k) ? ` (${newCount(k)} nouvelle${newCount(k) > 1 ? "s" : ""})` : ""}</button>`).join("");
  const f = state.reqFilter || "open";
  const openN = all.filter((r) => REQ_OPEN.includes(r.statut)).length;
  $("#reqFilters").innerHTML = [["open", `À traiter (${openN})`], ["all", `Toutes (${all.length})`]].map(([v, l]) => `<button class="chip ${f === v ? "active" : ""}" data-req-filter="${v}">${l}</button>`).join("");
  const list = all.filter((r) => f === "all" || REQ_OPEN.includes(r.statut));
  const isCand = state.reqKind === "candidature";
  $("#requestsList").innerHTML = list.length ? list.map((r) => {
    const d = r.data, bl = !isCand && blacklistedClient(d.nom);
    const info = isCand
      ? [d.telephone && `☎ ${esc(d.telephone)}`, d.age && `${esc(d.age)} ans`, d.discord && `Discord : ${esc(d.discord)}`, d.disponibilites && `Dispo : ${esc(d.disponibilites)}`]
      : [d.telephone && `☎ ${esc(d.telephone)}`, `Objet : ${esc(d.objet || "Autre")}`, d.bien && `Bien : ${esc(d.bien)}`, d.disponibilites && `Dispo : ${esc(d.disponibilites)}`];
    const texts = isCand ? [["Expérience", d.experience], ["Motivation", d.motivation]] : [["Message", d.message]];
    return `<article class="record-card req-card">
      <div class="record-main"><div class="record-title"><b>${esc(d.nom)}</b><span class="badge ${REQ_CLASS[r.statut] || ""}">${esc(r.statut)}</span>${bl ? `<span class="badge bad">⚠ Liste noire${bl.data.motif ? ` : ${esc(bl.data.motif)}` : ""}</span>` : ""}</div>
        <p>${info.filter(Boolean).join(" • ")}</p>
        ${texts.filter((x) => x[1]).map(([l, v]) => `<p class="req-text"><b>${l} :</b> ${esc(v)}</p>`).join("")}
        <small class="muted">Reçue le ${dateTime(r.created_at)}${r.assigned ? ` • suivie par <b>${esc(userName(r.assigned))}</b>` : ""}</small>
        <textarea class="req-notes" data-req-notes="${r.id}" rows="2" maxlength="2000" placeholder="Notes internes (visibles par l'équipe)…">${esc(r.notes || "")}</textarea>
      </div>
      <div class="req-actions">
        <select class="filter-select" data-req-status="${r.id}">${REQ_STATUS[r.kind].map((s) => `<option ${s === r.statut ? "selected" : ""}>${s}</option>`).join("")}</select>
        ${r.assigned !== state.me.username ? `<button class="mini-btn" data-req-take="${r.id}">Je m'en occupe</button>` : ""}
        ${isCand && r.statut === "Acceptée" && can("employes.gerer") ? `<button class="mini-btn" data-req-account="${r.id}">Créer son compte</button>` : ""}
        <button class="mini-btn danger" data-req-delete="${r.id}">Supprimer</button>
      </div></article>`;
  }).join("") : `<div class="empty-state">${all.length ? "Aucune demande à traiter. 👍" : isCand ? "Aucune candidature reçue. Ouvrez le recrutement dans les réglages de la vitrine (page Événements)." : "Aucune demande de rendez-vous pour l'instant."}</div>`;
}

async function patchRequest(id, body, msg) {
  try { await api(`requests/${id}`, { method: "PATCH", body }); if (msg) toast(msg); await loadAll(); }
  catch (err) { toast(err.message, "error"); }
}

document.addEventListener("change", (e) => {
  const st = e.target.closest("[data-req-status]");
  if (st) { patchRequest(Number(st.dataset.reqStatus), { statut: st.value }, "Statut mis à jour."); return; }
  const nt = e.target.closest("[data-req-notes]");
  if (nt) patchRequest(Number(nt.dataset.reqNotes), { notes: nt.value }, "Notes enregistrées.");
});

/* ---------- événements ---------- */

function renderEvents() {
  const evs = [...(state.events || [])].sort((a, b) => a.date - b.date);
  const now = Date.now() - 6 * 3600000;
  const up = evs.filter((e) => e.date >= now), past = evs.filter((e) => e.date < now).reverse();
  const card = (e, old) => `<article class="record-card ${old ? "past" : ""}">
    <div class="record-main user-main"><div class="ev-date"><b>${new Date(e.date).getDate()}</b><span>${esc(new Date(e.date).toLocaleDateString("fr-FR", { month: "short" }))}</span></div>
      <div><div class="record-title"><b>${esc(e.titre)}</b>${old ? `<span class="badge">Passé</span>` : `<span class="badge ok">Sur la vitrine</span>`}</div>
      <p>${esc(dateTime(e.date))}${e.lieu ? ` • ${esc(e.lieu)}` : ""}${e.description ? ` • ${esc(e.description)}` : ""}</p></div></div>
    <div class="record-meta"><div class="record-actions">${can("catalogue.gerer") ? `<button class="mini-btn" data-event-edit="${e.id}">Modifier</button><button class="mini-btn danger" data-event-delete="${e.id}">Supprimer</button>` : ""}</div></div></article>`;
  $("#eventsList").innerHTML = (up.length ? `<h4 class="cat-heading">À venir <span>${up.length}</span></h4>${up.map((e) => card(e, false)).join("")}` : `<div class="empty-state">Aucun événement prévu.${can("catalogue.gerer") ? " Ajoutez-en un : il apparaîtra sur la vitrine publique." : ""}</div>`)
    + (past.length ? `<h4 class="cat-heading">Passés <span>${past.length}</span></h4>${past.slice(0, 20).map((e) => card(e, true)).join("")}` : "");
}

function openEvent(id = null) {
  const ev = id ? state.events.find((x) => x.id === id) : null;
  state.editingEvent = ev?.id || null;
  const f = $("#eventForm");
  f.reset();
  $("#eventTitle").textContent = ev ? "Modifier l'événement" : "Nouvel événement";
  if (ev) {
    const d = new Date(ev.date), pad = (n) => String(n).padStart(2, "0");
    f.titre.value = ev.titre; f.lieu.value = ev.lieu; f.description.value = ev.description;
    f.date.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  $("#eventError").textContent = "";
  openModal("eventModal");
  setTimeout(() => f.titre.focus(), 40);
}

async function saveEvent(e) {
  e.preventDefault();
  const f = e.currentTarget, btn = f.querySelector("button[type=submit]");
  const body = { titre: f.titre.value, date: new Date(f.date.value).getTime(), lieu: f.lieu.value, description: f.description.value };
  setBusy(btn, true, "Enregistrement…");
  try {
    if (state.editingEvent) await api(`events/${state.editingEvent}`, { method: "PUT", body });
    else await api("events", { method: "POST", body });
    closeModal("eventModal");
    toast("Événement enregistré.");
    await loadAll();
  } catch (err) { $("#eventError").textContent = err.message; }
  finally { setBusy(btn, false); }
}

/* ---------- formulaires publics ---------- */

function openPublicForm(kind, bien = "") {
  const id = kind === "rdv" ? "rdv" : "cand";
  const f = $(`#${id}Form`);
  f.reset();
  f.classList.remove("hidden");
  $(`#${id}Done`).classList.add("hidden");
  $(`#${id}Error`).textContent = "";
  if (kind === "rdv" && bien) { f.bien.value = bien; const it = pub.items.find((c) => c.nom === bien); if (it) f.objet.value = it.prix_vente ? "Achat" : "Location"; }
  closeModal("photoModal");
  openModal(`${id}Modal`);
  setTimeout(() => f.nom.focus(), 40);
}

async function submitPublicForm(e, kind) {
  e.preventDefault();
  const id = kind === "rdv" ? "rdv" : "cand";
  const f = e.currentTarget, btn = f.querySelector("button[type=submit]");
  const body = Object.fromEntries(new FormData(f).entries());
  setBusy(btn, true, "Envoi…");
  try {
    const r = await fetch(`/api/public/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "L'envoi a échoué, réessayez.");
    f.classList.add("hidden");
    $(`#${id}Done`).classList.remove("hidden");
  } catch (err) { $(`#${id}Error`).textContent = err.message; }
  finally { setBusy(btn, false); }
}

/* ---------- vitrine publique ---------- */

const pub = { items: [], vitrine: {}, mode: "all", cat: "all", fromApp: false };

async function showPublic(fromApp = false) {
  pub.fromApp = fromApp;
  $("#app").classList.add("hidden");
  $("#loginScreen").classList.add("hidden");
  $("#publicSite").classList.remove("hidden");
  $("#publicLoginBtn").innerHTML = fromApp ? "Retour à l'intranet <span>→</span>" : "Espace employé <span>→</span>";
  try {
    const r = await fetch("/api/public/catalog");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Erreur");
    pub.items = d.items; pub.vitrine = d.vitrine; pub.events = d.events || [];
  } catch (e) {
    $("#pubGrid").innerHTML = `<div class="empty-state">Le catalogue est momentanément indisponible.</div>`;
    return;
  }
  renderPublic();
}

function pubAvailable(c) {
  if (pub.mode === "vente") return c.prix_vente > 0;
  if (pub.mode === "location") return c.prix_location > 0;
  return true;
}

function renderPublic() {
  const v = pub.vitrine || {};
  if (v.message) $("#pubMessage").textContent = v.message;
  $("#pubContact").innerHTML = [
    v.tel && `<div><span>Téléphone</span><b>☎ ${esc(v.tel)}</b></div>`,
    v.adresse && `<div><span>Concession</span><b>${esc(v.adresse)}</b></div>`,
    `<div><span>Nos vendeurs</span><b>Disponibles en ville</b></div>`,
  ].filter(Boolean).join("");
  $("#pubBienOptions").innerHTML = pub.items.map((c) => `<option value="${esc(c.nom)}">`).join("");
  const evs = pub.events || [];
  $("#evenements").classList.toggle("hidden", !evs.length);
  $("#pubNavEvents").classList.toggle("hidden", !evs.length);
  $("#pubEvents").innerHTML = evs.map((e) => { const d = new Date(e.date); return `
    <article class="pub-event"><div class="pub-event-date"><b>${d.getDate()}</b><span>${esc(d.toLocaleDateString("fr-FR", { month: "short" }))}</span></div>
      <div><h3>${esc(e.titre)}</h3><p class="pub-event-meta">${esc(d.toLocaleDateString("fr-FR", { weekday: "long" }).replace(/^./, (ch) => ch.toUpperCase()))} à ${esc(d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }))}${e.lieu ? ` • ${esc(e.lieu)}` : ""}</p>${e.description ? `<p class="muted">${esc(e.description)}</p>` : ""}</div></article>`; }).join("");
  $("#recrutement").classList.toggle("hidden", !v.recrutement);
  $("#pubNavJobs").classList.toggle("hidden", !v.recrutement);
  if (v.recrutementMessage) $("#pubJobsText").textContent = v.recrutementMessage;
  $("#biens").classList.toggle("hidden", !pub.items.length);
  $("#pubNavOcc").classList.toggle("hidden", !pub.items.length);
  const pool = pub.items.filter(pubAvailable);
  const counts = {};
  pool.forEach((c) => (counts[catOf(c)] = (counts[catOf(c)] || 0) + 1));
  const cats = [...CATEGORIES, "Non classé"].filter((c) => counts[c]);
  if (pub.cat !== "all" && !cats.includes(pub.cat)) pub.cat = "all";
  $("#pubCats").innerHTML = cats.length > 1 ? [["all", `Toutes catégories (${pool.length})`], ...cats.map((c) => [c, `${c} (${counts[c]})`])]
    .map(([val, l]) => `<button class="chip ${pub.cat === val ? "active" : ""}" data-pub-cat="${esc(val)}">${esc(l)}</button>`).join("") : "";
  $$("[data-pub-mode]").forEach((b) => b.classList.toggle("active", b.dataset.pubMode === pub.mode));
  const list = pool.filter((c) => pub.cat === "all" || catOf(c) === pub.cat);
  $("#pubGrid").innerHTML = list.length ? list.map((c) => `
    <button class="pub-card" data-pub-item="${c.id}">
      <div class="pub-photo">${c.photo_at ? `<img src="/api/public/photo/${c.id}?v=${c.photo_at}" alt="${esc(c.nom)}" loading="lazy">` : `<span class="pub-noimg">❖</span>`}<span class="pub-cat">Occasion</span></div>
      <div class="pub-body"><b>${esc(c.nom)}</b>${c.description ? `<p class="pub-desc">${esc(c.description)}</p>` : ""}
        <div class="pub-prices"><span><small>Prix</small>${money(c.prix_vente)}</span></div>
      </div>
    </button>`).join("") : `<div class="empty-state">${pub.items.length ? "Aucun véhicule ne correspond à ce filtre." : "Aucune occasion disponible pour le moment."}</div>`;
}

function openPublicItem(id) {
  const c = pub.items.find((x) => x.id === id);
  if (!c) return;
  $("#photoTitle").textContent = c.nom;
  const img = $("#photoFull");
  if (c.photo_at) { img.src = `/api/public/photo/${c.id}?v=${c.photo_at}`; img.classList.remove("hidden"); } else { img.removeAttribute("src"); img.classList.add("hidden"); }
  const v = pub.vitrine || {};
  $("#photoInfo").innerHTML = `<span class="badge">Occasion</span> Prix : <b>${money(c.prix_vente)}</b>${c.description ? `<br><span class="pub-info">${esc(c.description)}</span>` : ""}${v.tel ? `<br>Intéressé ? Appelez la concession au <b>${esc(v.tel)}</b>.` : ""}<br><button class="btn btn-primary pub-rdv-btn" data-pub-rdv="${esc(c.nom)}">Demander un rendez-vous pour ce véhicule</button>`;
  $("#photoInfo").classList.remove("hidden");
  openModal("photoModal");
}

/* ---------- événements ---------- */

document.addEventListener("click", async (e) => {
  const t = e.target;
  const nav = t.closest("[data-page]");
  if (nav && state.me) { e.preventDefault(); go(nav.dataset.page); return; }

  const rdvBtn = t.closest("[data-pub-rdv]");
  if (rdvBtn) { openPublicForm("rdv", rdvBtn.dataset.pubRdv); return; }
  if (t.closest("[data-pub-apply]")) { openPublicForm("cand"); return; }
  const rk = t.closest("[data-req-kind]");
  if (rk) { state.reqKind = rk.dataset.reqKind; renderRequests(); return; }
  const rf = t.closest("[data-req-filter]");
  if (rf) { state.reqFilter = rf.dataset.reqFilter; renderRequests(); return; }
  const take = t.closest("[data-req-take]");
  if (take) { patchRequest(Number(take.dataset.reqTake), { assigned: state.me.username, statut: "Prise en charge" }, "Demande prise en charge."); return; }
  const rdel = t.closest("[data-req-delete]");
  if (rdel) { if (await confirmDialog("Supprimer cette demande ?", "Elle sera retirée définitivement de la liste.")) { try { await api(`requests/${rdel.dataset.reqDelete}`, { method: "DELETE" }); toast("Demande supprimée."); await loadAll(); } catch (err) { toast(err.message, "error"); } } return; }
  const racc = t.closest("[data-req-account]");
  if (racc) { const r = state.requests.find((x) => x.id === Number(racc.dataset.reqAccount)); openUser(); if (r) $("#userForm").display_name.value = r.data.nom; return; }
  const po = t.closest("[data-profile-open]");
  if (po) { openProfile(po.dataset.profileOpen); return; }
  if (t.closest("#recPhotoPreview")) { $("#photoFull").src = $("#recPhotoPreview").src; $("#photoFull").classList.remove("hidden"); $("#photoTitle").textContent = "Capture de la vente"; $("#photoInfo").classList.add("hidden"); openModal("photoModal"); return; }
  if (t.closest("#idPhotoPreview")) { $("#photoFull").src = $("#idPhotoPreview").src; $("#photoFull").classList.remove("hidden"); $("#photoTitle").textContent = "Carte d'identité RP"; $("#photoInfo").classList.add("hidden"); openModal("photoModal"); return; }

  const eedit = t.closest("[data-event-edit]");
  if (eedit) { openEvent(Number(eedit.dataset.eventEdit)); return; }
  const edel = t.closest("[data-event-delete]");
  if (edel) { if (await confirmDialog("Supprimer cet événement ?", "Il disparaîtra aussi de la vitrine publique.")) { try { await api(`events/${edel.dataset.eventDelete}`, { method: "DELETE" }); toast("Événement supprimé."); await loadAll(); } catch (err) { toast(err.message, "error"); } } return; }

  const pm = t.closest("[data-pub-mode]");
  if (pm) { pub.mode = pm.dataset.pubMode; renderPublic(); return; }
  const pc = t.closest("[data-pub-cat]");
  if (pc) { pub.cat = pc.dataset.pubCat; renderPublic(); return; }
  const pi = t.closest("[data-pub-item]");
  if (pi) { openPublicItem(Number(pi.dataset.pubItem)); return; }
  if (t.closest("[data-pub-login]")) { goEmployee(); return; }
  if (t.closest("[data-pub-top]")) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }

  const quick = t.closest("[data-quick]");
  if (quick) { openRecord(quick.dataset.quick); return; }

  const close = t.closest("[data-close]");
  if (close) { closeModal(close.dataset.close); return; }

  const edit = t.closest("[data-edit]");
  if (edit) { openRecord(state.type, Number(edit.dataset.edit)); return; }

  const del = t.closest("[data-delete]");
  if (del) { deleteRecord(state.type, Number(del.dataset.delete)); return; }

  const open = t.closest("[data-open]");
  if (open) { const [type, id] = open.dataset.open.split(":"); if (type === "clients") openClient(Number(id)); else openRecord(type, Number(id)); return; }

  const ch = t.closest("[data-client-open]");
  if (ch) { const [type, id] = ch.dataset.clientOpen.split(":"); closeModal("clientModal"); openRecord(type, Number(id)); return; }

  if (t.closest("#journalMore")) { loadJournal(true); return; }

  const filter = t.closest("[data-filter]");
  if (filter) { state.filter = filter.dataset.filter; renderRecords(); return; }

  const ue = t.closest("[data-user-edit]");
  if (ue) { openUser(ue.dataset.userEdit); return; }

  const ud = t.closest("[data-user-delete]");
  if (ud) { deleteUser(ud.dataset.userDelete); return; }

  const vp = t.closest("[data-view-photo]");
  if (vp) { e.preventDefault(); viewPhoto(vp.dataset.viewPhoto, vp.dataset.photoTitle); return; }

  const gm = t.closest("[data-grade-move]");
  if (gm) { try { await api(`grades/${encodeURIComponent(gm.dataset.gradeMove)}/move`, { method: "POST", body: { dir: Number(gm.dataset.dir) } }); await loadAll(); } catch (err) { toast(err.message, "error"); } return; }

  const ge = t.closest("[data-grade-edit]");
  if (ge) { openGrade(ge.dataset.gradeEdit); return; }

  const gd = t.closest("[data-grade-delete]");
  if (gd) { deleteGrade(gd.dataset.gradeDelete); return; }

  const cf = t.closest("[data-cat-filter]");
  if (cf) { state.catFilter = cf.dataset.catFilter; renderCatalog(); return; }

  const ce = t.closest("[data-cat-edit]");
  if (ce) { openCatalog(Number(ce.dataset.catEdit)); return; }

  const cd = t.closest("[data-cat-delete]");
  if (cd) { deleteCatalog(Number(cd.dataset.catDelete)); return; }

  const ad = t.closest("[data-archive-delete]");
  if (ad) {
    if (await confirmDialog("Supprimer cet historique ?", "Cette semaine archivée sera retirée de l'historique. Les dossiers ne sont pas touchés.")) {
      try { await api(`ca/archives/${ad.dataset.archiveDelete}`, { method: "DELETE" }); toast("Historique supprimé."); await loadAll(); }
      catch (err) { toast(err.message, "error"); }
    }
    return;
  }

  if (t.classList.contains("modal-backdrop") && t.id !== "confirmModal") closeModal(t.id);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$("#confirmModal").classList.contains("hidden")) $("#confirmCancel").click();
    else $$(".modal-backdrop:not(.hidden)").forEach((m) => closeModal(m.id));
    closeSidebar();
  }
  if (e.key === "Enter" && e.target.matches(".record-card[data-open]")) e.target.click();
});

document.addEventListener("input", (e) => { if (e.target.matches("#recordFields input[data-vehicle]")) onVehicleInput(e.target); });
document.addEventListener("change", (e) => {
  if (e.target.matches("#catalogForm select[name=categorie]")) { syncCatalogForm(); return; }
  if (!e.target.closest("#recordForm")) return;
  if (!e.target.matches("select[data-catalog], select[name=duree], select[name=partenariat]")) return;
  const form = e.target.form;
  if (e.target.matches("select[name=partenariat]")) { recalcSale(form); return; }
  const sel = form.querySelector("select[data-catalog]");
  if (sel && e.target === sel) updateCatalogPreview(sel);
  const opt = sel?.selectedOptions[0];
  if (!opt || !opt.dataset.price) return;
  const isRent = sel.dataset.catalog === "location";
  if (!isRent) {
    const base = form.querySelector("[name=prix_base]");
    if (base) base.value = opt.dataset.price;
    recalcSale(form);
    const b = form.querySelector("[name=bien]");
    if (b && !b.value) b.placeholder = `ex. ${opt.value} n°…`;
    return;
  }
  const amount = form.querySelector(isRent ? "[name=loyer]" : "[name=prix]");
  const weeks = isRent ? weeksOf(form.querySelector("[name=duree]")?.value) : 1;
  if (amount) { amount.value = Number(opt.dataset.price) * weeks; amount.dispatchEvent(new Event("input", { bubbles: true })); }
  const hint = amount && document.querySelector(`[data-money-for="${amount.name}"]`);
  if (hint && isRent) hint.textContent = `${money(opt.dataset.price)} × ${weeks} semaine${weeks > 1 ? "s" : ""} = ${money(amount.value)}`;
  const bien = form.querySelector("[name=bien]");
  if (bien && !bien.value) bien.placeholder = `ex. ${opt.value} n°…`;
});

function blacklistedClient(name) {
  const n = String(name || "").trim().toLowerCase();
  return n ? (state.records.clients || []).find((c) => c.data.liste_noire && (c.data.nom || "").trim().toLowerCase() === n) : null;
}
function updateBlacklistWarn(input) {
  const w = document.querySelector(`[data-bl-for="${input.name}"]`);
  if (!w) return;
  const c = blacklistedClient(input.value);
  w.classList.toggle("hidden", !c);
  w.textContent = c ? `⚠ Client sur liste noire${c.data.motif ? ` : ${c.data.motif}` : ""}` : "";
}

document.addEventListener("input", (e) => {
  if (e.target.matches("#recordFields [data-bl-for]") || e.target.matches("#recordFields input[list=clientOptions]")) updateBlacklistWarn(e.target);
  const m = e.target.closest("#recordFields input[type=number]");
  if (m) { const hint = $(`[data-money-for="${m.name}"]`); if (hint) hint.textContent = m.value ? money(Number(m.value)) : ""; }
  if (m && m.name === "prix_base") recalcSale(m.form);
});

// Prix final = prix de base − remise du partenariat
function recalcSale(form) {
  const baseInput = form.querySelector("[name=prix_base]");
  const prix = form.querySelector("[name=prix]");
  if (!baseInput || !prix) return;
  const base = Number(baseInput.value) || 0;
  const p = form.querySelector("select[name=partenariat]")?.selectedOptions[0];
  const r = Number(p?.dataset.remise) || 0;
  const baseHint = $('[data-money-for="prix_base"]');
  if (baseHint) baseHint.textContent = base ? money(base) : "";
  if (!base) return;
  prix.value = Math.round(base * (1 - r / 100));
  const hint = $('[data-money-for="prix"]');
  if (hint) hint.textContent = r ? `${money(base)} − ${r} % (${p.value}) = ${money(prix.value)}` : money(prix.value);
}

function partnerSales(org) {
  const n = String(org || "").trim().toLowerCase();
  if (!n) return "";
  const v = (state.records.ventes || []).filter((x) => (x.data.partenariat || "").trim().toLowerCase() === n).length;
  return v ? `${v} vente${v > 1 ? "s" : ""} liée${v > 1 ? "s" : ""}` : "";
}

function goEmployee() {
  if (pub.fromApp && state.me) { $("#publicSite").classList.add("hidden"); $("#app").classList.remove("hidden"); return; }
  history.replaceState(null, "", "#espace");
  showLogin(false);
}
$("#publicLoginBtn").addEventListener("click", goEmployee);
$("#backToPublic").addEventListener("click", () => { history.replaceState(null, "", location.pathname); showPublic(); });
$("#vitrineBtn").addEventListener("click", async () => {
  const f = $("#vitrineForm");
  $("#vitrineError").textContent = "";
  try { const d = await (await fetch("/api/public/catalog")).json(); f.message.value = d.vitrine?.message || ""; f.tel.value = d.vitrine?.tel || ""; f.adresse.value = d.vitrine?.adresse || ""; f.recrutement.checked = !!d.vitrine?.recrutement; f.recrutementMessage.value = d.vitrine?.recrutementMessage || ""; } catch { /* ignore */ }
  openModal("vitrineModal");
});
$("#vitrineForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.currentTarget, btn = f.querySelector("button[type=submit]");
  setBusy(btn, true, "Enregistrement…");
  try {
    await api("vitrine", { method: "POST", body: { message: f.message.value, tel: f.tel.value, adresse: f.adresse.value, recrutement: f.recrutement.checked, recrutementMessage: f.recrutementMessage.value } });
    closeModal("vitrineModal");
    toast("Vitrine mise à jour.");
  } catch (err) { $("#vitrineError").textContent = err.message; }
  finally { setBusy(btn, false); }
});
$("#rdvForm").addEventListener("submit", (e) => submitPublicForm(e, "rdv"));
$("#candForm").addEventListener("submit", (e) => submitPublicForm(e, "candidature"));
$("#addEventBtn").addEventListener("click", () => openEvent());
$("#profileForm").addEventListener("submit", saveProfile);
$("#idPhotoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("#profileError").textContent = "";
  try { const data = await compressImage(file); Object.assign(state.editingProfile, { idChanged: true, idData: data }); setIdPreview(data); }
  catch (err) { $("#profileError").textContent = err.message; }
  e.target.value = "";
});
$("#recordFields").addEventListener("change", async (e) => {
  if (e.target.id !== "recPhotoInput") return;
  const file = e.target.files[0];
  if (!file) return;
  $("#recordError").textContent = "";
  try { const data = await compressImage(file); state.editing.photo = data; setRecPhoto(data); }
  catch (err) { $("#recordError").textContent = err.message; }
  e.target.value = "";
});
$("#idPhotoRemove").addEventListener("click", () => { Object.assign(state.editingProfile, { idChanged: true, idData: null }); setIdPreview(null); });
$("#eventForm").addEventListener("submit", saveEvent);
$("#loginForm").addEventListener("submit", login);
$("#setupForm").addEventListener("submit", setup);
$("#logoutBtn").addEventListener("click", logout);
$("#addRecordBtn").addEventListener("click", () => openRecord(state.type));
$("#recordForm").addEventListener("submit", saveRecord);
$("#recordDeleteBtn").addEventListener("click", () => deleteRecord(state.editing.type, state.editing.id));
$("#recordSearch").addEventListener("input", renderRecords);
$("#mineOnly").addEventListener("change", renderRecords);
$("#addUserBtn").addEventListener("click", () => openUser());
$("#userForm").addEventListener("submit", saveUser);
$("#passwordForm").addEventListener("submit", changePassword);
$("#addCatalogBtn").addEventListener("click", () => openCatalog());
$("#addGradeBtn").addEventListener("click", () => openGrade());
$("#objectivesBtn").addEventListener("click", openObjectives);
$("#soldeBtn").addEventListener("click", openSolde);
$("#soldeForm").addEventListener("submit", saveSolde);
$("#objectivesForm").addEventListener("submit", saveObjectives);
["#journalUser", "#journalType"].forEach((s) => $(s).addEventListener("change", renderJournal));
$("#journalSearch").addEventListener("input", renderJournal);
$("#gradeForm").addEventListener("submit", saveGrade);
$("#catalogForm").addEventListener("submit", saveCatalog);
$("#catalogPhotoInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $("#catalogError").textContent = "";
  try {
    const data = await compressImage(file);
    state.catalogPhoto = { ...state.catalogPhoto, changed: true, data };
    setCatalogPreview(data);
  } catch (err) { $("#catalogError").textContent = err.message; }
  e.target.value = "";
});
$("#catalogPhotoRemove").addEventListener("click", () => {
  state.catalogPhoto = { ...state.catalogPhoto, changed: true, data: null };
  setCatalogPreview(null);
});
$("#resetCaBtn").addEventListener("click", resetCA);
$("#mobileMenu").addEventListener("click", () => { $("#sidebar").classList.add("open"); $("#sidebarScrim").classList.add("show"); });
$("#sidebarScrim").addEventListener("click", closeSidebar);
window.addEventListener("hashchange", () => {
  if (state.me) { if (!$("#app").classList.contains("hidden")) go(location.hash.slice(1) || "dashboard"); return; }
  if (location.hash === "#espace" && $("#loginScreen").classList.contains("hidden")) showLogin(false);
});

// Rafraîchissement automatique toutes les 45 s (si l'onglet est visible et aucune fenêtre ouverte)
setInterval(() => {
  if (state.me && document.visibilityState === "visible" && !document.body.classList.contains("modal-open")) loadAll();
}, 45000);
document.addEventListener("visibilitychange", () => { if (state.me && document.visibilityState === "visible") loadAll(); });

applyBackground();
boot();
