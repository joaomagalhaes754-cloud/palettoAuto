/**
 * Paletto Auto — API de l'intranet (Cloudflare Pages Functions + D1)
 * Toutes les routes /api/* passent par ce fichier.
 * La base D1 doit être liée sous le nom « DB ». Les tables sont créées automatiquement.
 */

// Permissions attribuables à un grade (le grade « Directeur » les a toujours toutes)
const PERMS = [
  "dossiers.creer", "dossiers.modifier_siens", "dossiers.modifier_tous", "dossiers.supprimer", "dossiers.attribuer",
  "ca.equipe", "ca.cloturer", "catalogue.gerer", "employes.voir", "employes.gerer", "grades.gerer",
  "depenses.gerer", "journal.voir", "rdv.gerer", "recrutement.gerer",
];
const DEFAULT_GRADES = [
  ["Directeur", PERMS],
  ["Responsable", ["dossiers.creer", "dossiers.modifier_siens", "dossiers.modifier_tous", "dossiers.supprimer", "dossiers.attribuer", "ca.equipe", "catalogue.gerer", "employes.voir"]],
  ["Vendeur", ["dossiers.creer", "dossiers.modifier_siens"]],
  ["Stagiaire", ["dossiers.creer"]],
];
const can = (me, perm) => me.grade === "Directeur" || (me.perms || []).includes(perm);
const SESSION_TTL = 7 * 24 * 3600 * 1000; // 7 jours
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;
const PBKDF2_ITERATIONS = 100000; // maximum autorisé par Cloudflare Workers

// Structure de chaque type de dossier (le serveur fait foi).
const SCHEMA = {
  ventes: {
    fields: { vehicule: "text", plaque: "text", client: "text", agent: "user", prix_base: "money", partenariat: "text", remise: "percent", prix: "money", notes: "long" },
    required: ["vehicule", "prix"],
    amount: "prix",
    counted: true, // une vente est enregistrée uniquement quand elle est conclue
    photoRequired: true, // capture d'écran de la facture en jeu obligatoire
  },
  clients: {
    fields: { nom: "text", telephone: "text", employeur: "text", liste_noire: "bool", motif: "text" },
    required: ["nom"],
  },
  partenariats: {
    fields: { organisation: "text", contact: "text", type: "text", remise: "percent", notes: "long" },
    required: ["organisation"],
  },
  depenses: {
    fields: { libelle: "text", categorie: ["Achat de véhicules", "Salaires", "Frais de fonctionnement", "Autre"], montant: "money", notes: "long" },
    required: ["libelle", "montant"],
    amount: "montant",
    counted: true,
    perm: "depenses.gerer", // réservé aux grades qui ont cette permission
  },
};
const TYPE_LABEL = { ventes: "Vente", locations: "Location", clients: "Client", partenariats: "Partenariat", depenses: "Dépense" };
const fmt$ = (n) => `${Math.round(n || 0).toLocaleString("fr-FR")} $`;
const CATEGORIES = ["Neuf", "Occasion"];
const FIELD_LABELS = { vehicule: "Véhicule", libelle: "Libellé", montant: "Montant", bien: "Bien / propriété", prix: "Prix de vente", loyer: "Montant encaissé", nom: "Nom Prénom", organisation: "Organisation" };

const INIT_SQL = [
  `CREATE TABLE IF NOT EXISTS d8_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    statut TEXT NOT NULL,
    assigned TEXT,
    notes TEXT NOT NULL DEFAULT '',
    ip_hash TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS d8_requests_kind ON d8_requests(kind, created_at)`,
  `CREATE TABLE IF NOT EXISTS d8_profiles (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS d8_idphotos (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS d8_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titre TEXT NOT NULL,
    date INTEGER NOT NULL,
    lieu TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS d8_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS d8_logs_at ON d8_logs(at)`,
  `CREATE TABLE IF NOT EXISTS d8_grades (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    position INTEGER NOT NULL,
    permissions TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS d8_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    grade TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS d8_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS d8_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    agent TEXT,
    amount INTEGER NOT NULL DEFAULT 0,
    closed_at INTEGER,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS d8_records_type ON d8_records(type, created_at)`,
  `CREATE INDEX IF NOT EXISTS d8_records_closed ON d8_records(closed_at)`,
  `CREATE TABLE IF NOT EXISTS d8_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS d8_ca_archives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_start INTEGER NOT NULL,
    period_end INTEGER NOT NULL,
    total INTEGER NOT NULL,
    details TEXT NOT NULL,
    reset_by TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS d8_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    prix_vente INTEGER NOT NULL DEFAULT 0,
    prix_location INTEGER NOT NULL DEFAULT 0,
    duree TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS d8_recphotos (
    record_id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS d8_photos (
    catalog_id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL)`,
];

/* ---------- utilitaires ---------- */

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS }, key, 256);
  return hex(bits);
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const cleanText = (v, max = 200) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, max);
function cleanUsername(v) {
  const u = String(v ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(u)) fail(400, "Identifiant invalide : 3 à 32 caractères (lettres, chiffres, point, tiret).");
  return u;
}
function cleanPassword(v) {
  const p = String(v ?? "");
  if (p.length < 8 || p.length > 128) fail(400, "Le mot de passe doit contenir au moins 8 caractères.");
  return p;
}
async function cleanGrade(db, v) {
  const g = await db.prepare("SELECT name FROM d8_grades WHERE name = ?").bind(String(v ?? "")).first();
  if (!g) fail(400, "Grade invalide.");
  return g.name;
}
async function gradePerms(db, grade) {
  if (grade === "Directeur") return [...PERMS];
  const g = await db.prepare("SELECT permissions FROM d8_grades WHERE name = ?").bind(grade).first();
  try { return g ? JSON.parse(g.permissions).filter((x) => PERMS.includes(x)) : []; } catch { return []; }
}
function cleanMoney(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[\s  $€]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 1e12) fail(400, "Montant invalide.");
  return Math.round(n);
}
// Journal d'activité (ne bloque jamais l'action si l'écriture échoue)
async function logAction(db, me, action, type, label, details = "") {
  try {
    await db.prepare("INSERT INTO d8_logs (at, username, action, type, label, details) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(Date.now(), me.username, action, type, String(label || "").slice(0, 200), String(details || "").slice(0, 600)).run();
  } catch (e) { console.error("log", e); }
}
const recordLabel = (type, d) => d.vehicule || d.bien || d.nom || d.organisation || d.libelle || TYPE_LABEL[type];
const publicUser = (u, perms) => ({ username: u.username, display_name: u.display_name, grade: u.grade, permissions: perms || [] });

/* ---------- base de données ---------- */

let initialized = false;
async function init(db) {
  if (initialized) return;
  await db.batch(INIT_SQL.map((s) => db.prepare(s)));
  // Mise à niveau : catégorie des biens du catalogue (ignorée si la colonne existe déjà)
  try { await db.prepare("ALTER TABLE d8_catalog ADD COLUMN categorie TEXT NOT NULL DEFAULT ''").run(); } catch { /* déjà présente */ }
  try { await db.prepare("ALTER TABLE d8_catalog ADD COLUMN public INTEGER NOT NULL DEFAULT 1").run(); } catch { /* déjà présente */ }
  try { await db.prepare("ALTER TABLE d8_catalog ADD COLUMN description TEXT NOT NULL DEFAULT ''").run(); } catch { /* déjà présente */ }
  // Grades par défaut, créés une seule fois
  if (!(await db.prepare("SELECT COUNT(*) AS n FROM d8_grades").first()).n) {
    await db.batch(DEFAULT_GRADES.map(([name, perms], i) =>
      db.prepare("INSERT OR IGNORE INTO d8_grades (name, position, permissions) VALUES (?, ?, ?)").bind(name, i, JSON.stringify(perms))));
  }
  initialized = true;
}
const countUsers = async (db) => (await db.prepare("SELECT COUNT(*) AS n FROM d8_users").first()).n;
const countDirectors = async (db) => (await db.prepare("SELECT COUNT(*) AS n FROM d8_users WHERE grade='Directeur'").first()).n;

async function createSession(db, userId) {
  const token = randomHex(32);
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM d8_sessions WHERE expires_at < ?").bind(now),
    db.prepare("INSERT INTO d8_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), userId, now + SESSION_TTL),
  ]);
  return token;
}
async function currentUser(request, db) {
  const m = (request.headers.get("authorization") || "").match(/^Bearer ([a-f0-9]{64})$/);
  if (!m) return null;
  const tokenHash = await sha256(m[1]);
  const row = await db.prepare(
    "SELECT u.id, u.username, u.display_name, u.grade, s.expires_at FROM d8_sessions s JOIN d8_users u ON u.id = s.user_id WHERE s.token_hash = ?"
  ).bind(tokenHash).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await db.prepare("DELETE FROM d8_sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  return { ...row, tokenHash, perms: await gradePerms(db, row.grade) };
}

/* ---------- routeur ---------- */

export async function onRequest({ request, env, params }) {
  try {
    if (!env.DB) fail(500, "Base de données non liée : ajoutez un binding D1 nommé « DB » dans les réglages Cloudflare Pages, puis redéployez.");
    const db = env.DB;
    await init(db);

    const method = request.method;
    const [a, b, c, d] = [].concat(params.path || []);
    let body = {};
    if (["POST", "PUT", "PATCH"].includes(method)) {
      body = await request.json().catch(() => ({}));
      if (!body || typeof body !== "object" || Array.isArray(body)) body = {};
    }

    // Routes publiques
    if (a === "setup") return await setup(db, method, body);
    if (a === "login" && method === "POST") return await login(db, body);
    if (a === "public") return await publicApi(db, request, method, b, c, body);

    // Routes protégées
    const me = await currentUser(request, db);
    if (!me) fail(401, "Session expirée, veuillez vous reconnecter.");

    if (a === "logout" && method === "POST") {
      await db.prepare("DELETE FROM d8_sessions WHERE token_hash = ?").bind(me.tokenHash).run();
      return json({ ok: true });
    }
    if (a === "me" && !b && method === "GET") return json(publicUser(me, me.perms));
    if (a === "me" && b === "password" && method === "POST") return await changeOwnPassword(db, me, body);
    if (a === "users") return await users(db, me, method, b, body);
    if (a === "profiles") return await profiles(db, me, method, b, c, body);
    if (a === "records" && SCHEMA[b]) return await records(db, me, method, b, c, body, d);
    if (a === "ca") return await ca(db, me, method, b, c, body);
    if (a === "catalog") return await catalog(db, me, method, b, c, body);
    if (a === "grades") return await grades(db, me, method, b, c, body);
    if (a === "vitrine" && method === "POST") return await saveVitrine(db, me, body);
    if (a === "requests") return await requests(db, me, method, b, body, new URL(request.url));
    if (a === "events") return await events(db, me, method, b, body);
    if (a === "logs" && method === "GET") return await logs(db, me, new URL(request.url));
    fail(404, "Route introuvable.");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Erreur interne du serveur." }, 500);
  }
}

/* ---------- installation & connexion ---------- */

async function setup(db, method, body) {
  const n = await countUsers(db);
  if (method === "GET") return json({ needsSetup: n === 0 });
  if (method !== "POST") fail(405, "Méthode non autorisée.");
  if (n > 0) fail(403, "L'installation est déjà terminée.");
  const username = cleanUsername(body.username);
  const display = cleanText(body.display_name, 60) || username;
  const password = cleanPassword(body.password);
  const salt = randomHex(16);
  const res = await db.prepare(
    "INSERT INTO d8_users (username, display_name, grade, password_hash, salt, created_at) VALUES (?, ?, 'Directeur', ?, ?, ?)"
  ).bind(username, display, await hashPassword(password, salt), salt, Date.now()).run();
  const token = await createSession(db, res.meta.last_row_id);
  return json({ token, user: { username, display_name: display, grade: "Directeur", permissions: [...PERMS] } }, 201);
}

async function login(db, body) {
  const generic = "Identifiant ou mot de passe incorrect.";
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const u = await db.prepare("SELECT * FROM d8_users WHERE username = ?").bind(username).first();
  if (!u) {
    await hashPassword(password, "00".repeat(16)); // même temps de réponse
    fail(401, generic);
  }
  const now = Date.now();
  if (u.locked_until > now) fail(429, `Trop de tentatives. Réessayez dans ${Math.ceil((u.locked_until - now) / 60000)} min.`);
  const hash = await hashPassword(password, u.salt);
  if (!safeEqual(hash, u.password_hash)) {
    const fails = u.failed_attempts + 1;
    const locked = fails >= MAX_FAILS ? now + LOCK_MS : 0;
    await db.prepare("UPDATE d8_users SET failed_attempts = ?, locked_until = ? WHERE id = ?").bind(locked ? 0 : fails, locked, u.id).run();
    fail(401, locked ? "Trop de tentatives. Compte bloqué pendant 5 minutes." : generic);
  }
  await db.prepare("UPDATE d8_users SET failed_attempts = 0, locked_until = 0 WHERE id = ?").bind(u.id).run();
  return json({ token: await createSession(db, u.id), user: publicUser(u, await gradePerms(db, u.grade)) });
}

async function changeOwnPassword(db, me, body) {
  const u = await db.prepare("SELECT * FROM d8_users WHERE id = ?").bind(me.id).first();
  const current = await hashPassword(String(body.current || ""), u.salt);
  if (!safeEqual(current, u.password_hash)) fail(400, "Mot de passe actuel incorrect.");
  const next = cleanPassword(body.next);
  const salt = randomHex(16);
  await db.batch([
    db.prepare("UPDATE d8_users SET password_hash = ?, salt = ? WHERE id = ?").bind(await hashPassword(next, salt), salt, me.id),
    db.prepare("DELETE FROM d8_sessions WHERE user_id = ? AND token_hash != ?").bind(me.id, me.tokenHash),
  ]);
  return json({ ok: true });
}

/* ---------- employés ---------- */

async function users(db, me, method, username, body) {
  if (method === "GET" && !username) {
    const { results } = await db.prepare(
      `SELECT u.username, u.display_name, u.grade, u.created_at FROM d8_users u
       LEFT JOIN d8_grades g ON g.name = u.grade
       ORDER BY COALESCE(g.position, 999), u.display_name COLLATE NOCASE`
    ).all();
    return json(results);
  }
  if (!can(me, "employes.gerer")) fail(403, "Vous n'avez pas le droit de gérer les comptes employés.");

  if (method === "POST" && !username) {
    const uname = cleanUsername(body.username);
    const display = cleanText(body.display_name, 60) || uname;
    const grade = await cleanGrade(db, body.grade);
    if (grade === "Directeur" && me.grade !== "Directeur") fail(403, "Seul un Directeur peut créer un compte Directeur.");
    const password = cleanPassword(body.password);
    if (await db.prepare("SELECT 1 FROM d8_users WHERE username = ?").bind(uname).first()) fail(409, "Cet identifiant est déjà utilisé.");
    const salt = randomHex(16);
    await db.prepare(
      "INSERT INTO d8_users (username, display_name, grade, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(uname, display, grade, await hashPassword(password, salt), salt, Date.now()).run();
    await logAction(db, me, "création", "Employé", display, `Identifiant ${uname} • grade ${grade}`);
    return json({ username: uname, display_name: display, grade }, 201);
  }

  if (!username) fail(404, "Route introuvable.");
  const target = await db.prepare("SELECT * FROM d8_users WHERE username = ?").bind(String(username).toLowerCase()).first();
  if (!target) fail(404, "Employé introuvable.");
  if (target.grade === "Directeur" && me.grade !== "Directeur") fail(403, "Seul un Directeur peut modifier ou supprimer un compte Directeur.");

  if (method === "PATCH") {
    const display = body.display_name !== undefined ? (cleanText(body.display_name, 60) || target.username) : target.display_name;
    let grade = target.grade;
    if (body.grade !== undefined && body.grade !== target.grade) {
      grade = await cleanGrade(db, body.grade);
      if (grade === "Directeur" && me.grade !== "Directeur") fail(403, "Seul un Directeur peut attribuer le grade Directeur.");
      if (target.id === me.id) fail(400, "Vous ne pouvez pas modifier votre propre grade.");
      if (target.grade === "Directeur" && (await countDirectors(db)) <= 1) fail(400, "Il doit rester au moins un Directeur.");
    }
    const stmts = [db.prepare("UPDATE d8_users SET display_name = ?, grade = ? WHERE id = ?").bind(display, grade, target.id)];
    if (body.password) {
      const salt = randomHex(16);
      const hash = await hashPassword(cleanPassword(body.password), salt);
      stmts.push(db.prepare("UPDATE d8_users SET password_hash = ?, salt = ?, failed_attempts = 0, locked_until = 0 WHERE id = ?").bind(hash, salt, target.id));
      if (target.id !== me.id) stmts.push(db.prepare("DELETE FROM d8_sessions WHERE user_id = ?").bind(target.id));
    }
    await db.batch(stmts);
    const changes = [display !== target.display_name && `nom : ${target.display_name} → ${display}`, grade !== target.grade && `grade : ${target.grade} → ${grade}`, body.password && "mot de passe réinitialisé"].filter(Boolean);
    if (changes.length) await logAction(db, me, "modification", "Employé", display, changes.join(" • "));
    return json({ username: target.username, display_name: display, grade });
  }

  if (method === "DELETE") {
    if (target.id === me.id) fail(400, "Vous ne pouvez pas supprimer votre propre compte.");
    if (target.grade === "Directeur" && (await countDirectors(db)) <= 1) fail(400, "Il doit rester au moins un Directeur.");
    await db.batch([
      db.prepare("DELETE FROM d8_sessions WHERE user_id = ?").bind(target.id),
      db.prepare("DELETE FROM d8_users WHERE id = ?").bind(target.id),
      db.prepare("DELETE FROM d8_profiles WHERE username = ?").bind(target.username),
      db.prepare("DELETE FROM d8_idphotos WHERE username = ?").bind(target.username),
    ]);
    await logAction(db, me, "suppression", "Employé", target.display_name, `Identifiant ${target.username} • grade ${target.grade}`);
    return json({ ok: true });
  }
  fail(405, "Méthode non autorisée.");
}

/* ---------- dossiers ---------- */

function canEditRecord(me, rec) {
  if (can(me, "dossiers.modifier_tous")) return true;
  return can(me, "dossiers.modifier_siens") && (rec.created_by === me.username || rec.agent === me.username);
}

async function cleanRecord(db, me, spec, body, existing) {
  const data = {};
  let agent = null;
  for (const [key, kind] of Object.entries(spec.fields)) {
    const raw = body[key];
    if (kind === "money") data[key] = cleanMoney(raw);
    else if (kind === "bool") data[key] = raw === true || raw === "on" || raw === "true" || raw === 1;
    else if (kind === "percent") {
      const n = Number(String(raw ?? "").replace(",", ".").replace("%", "").trim() || 0);
      if (!Number.isFinite(n) || n < 0 || n > 100) fail(400, "Pourcentage de remise invalide (entre 0 et 100).");
      data[key] = Math.round(n * 10) / 10;
    }
    else if (Array.isArray(kind)) {
      const v = cleanText(raw, 40);
      data[key] = kind.includes(v) ? v : (existing ? JSON.parse(existing.data)[key] || kind[0] : kind[0]);
    } else if (kind === "user") {
      let v;
      if (!can(me, "dossiers.attribuer")) v = existing ? (existing.agent || me.username) : me.username;
      else v = cleanText(raw, 32).toLowerCase() || me.username;
      const known = await db.prepare("SELECT 1 FROM d8_users WHERE username = ?").bind(v).first();
      if (!known && !(existing && existing.agent === v)) fail(400, "Agent responsable inconnu.");
      data[key] = v;
      agent = v;
    } else data[key] = cleanText(raw, kind === "long" ? 2000 : 200);
  }
  for (const k of spec.required) if (!data[k]) fail(400, `Le champ « ${FIELD_LABELS[k] || k} » est obligatoire.`);
  const amount = spec.amount ? data[spec.amount] : 0;
  const counted = spec.counted === true || !!(Array.isArray(spec.counted) && spec.counted.includes(data.statut));
  return { data, agent, amount, counted };
}

const parseRow = (r) => ({ ...r, data: JSON.parse(r.data) });

const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function cleanRecordPhoto(v) {
  const data = String(v || "");
  if (!PHOTO_RE.test(data)) fail(400, "Format d'image non pris en charge (JPG, PNG ou WEBP).");
  if (data.length > 1500000) fail(400, "Capture trop lourde.");
  return data;
}
const savePhoto = (db, id, data, now) => db.prepare("INSERT INTO d8_recphotos (record_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(record_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(id, data, now).run();
const PHOTO_MISSING = "La capture d'écran de la vente en jeu est obligatoire.";

async function records(db, me, method, type, id, body, sub) {
  const spec = SCHEMA[type];
  const now = Date.now();
  if (spec.perm && !can(me, spec.perm)) fail(403, "Votre grade ne permet pas d'accéder à cette section.");

  if (method === "GET" && !id) {
    const { results } = await db.prepare("SELECT r.*, p.updated_at AS photo_at FROM d8_records r LEFT JOIN d8_recphotos p ON p.record_id = r.id WHERE r.type = ? ORDER BY r.created_at DESC").bind(type).all();
    return json(results.map(parseRow));
  }
  if (method === "POST" && !id) {
    if (!spec.perm && !can(me, "dossiers.creer")) fail(403, "Votre grade ne permet pas de créer des dossiers.");
    const r = await cleanRecord(db, me, spec, body, null);
    let photo = null;
    if (spec.photoRequired) { if (!body.photo) fail(400, PHOTO_MISSING); photo = cleanRecordPhoto(body.photo); }
    const res = await db.prepare(
      "INSERT INTO d8_records (type, data, agent, amount, closed_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(type, JSON.stringify(r.data), r.agent, r.amount, r.counted ? now : null, me.username, now, now).run();
    const newId = res.meta.last_row_id;
    if (photo) {
      try { await savePhoto(db, newId, photo, now); }
      catch (e) { await db.prepare("DELETE FROM d8_records WHERE id = ?").bind(newId).run(); throw e; }
    }
    const row = await db.prepare("SELECT r.*, p.updated_at AS photo_at FROM d8_records r LEFT JOIN d8_recphotos p ON p.record_id = r.id WHERE r.id = ?").bind(newId).first();
    await logAction(db, me, "création", TYPE_LABEL[type], recordLabel(type, r.data), (spec.amount ? fmt$(r.amount) + (r.data.partenariat ? ` • partenaire ${r.data.partenariat} (−${r.data.remise || 0} %)` : "") : "") + (photo ? " • capture jointe" : ""));
    return json(parseRow(row), 201);
  }

  const rec = /^\d+$/.test(String(id)) ? await db.prepare("SELECT * FROM d8_records WHERE id = ? AND type = ?").bind(Number(id), type).first() : null;
  if (!rec) fail(404, "Dossier introuvable.");

  if (sub === "photo") {
    if (!spec.photoRequired || method !== "GET") fail(405, "Méthode non autorisée.");
    const p = await db.prepare("SELECT data, updated_at FROM d8_recphotos WHERE record_id = ?").bind(rec.id).first();
    if (!p) fail(404, "Aucune capture pour cette vente.");
    return json(p);
  }
  if (sub) fail(404, "Route inconnue.");

  if (method === "PUT") {
    if (!spec.perm && !canEditRecord(me, rec)) fail(403, "Vous n'avez pas le droit de modifier ce dossier.");
    const r = await cleanRecord(db, me, spec, body, rec);
    let photo = null;
    if (spec.photoRequired) {
      if (body.photo) photo = cleanRecordPhoto(body.photo);
      else if (!(await db.prepare("SELECT 1 AS x FROM d8_recphotos WHERE record_id = ?").bind(rec.id).first())) fail(400, PHOTO_MISSING);
    }
    if (photo) await savePhoto(db, rec.id, photo, now);
    const closedAt = r.counted ? (rec.closed_at || now) : null;
    await db.prepare("UPDATE d8_records SET data = ?, agent = ?, amount = ?, closed_at = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(r.data), r.agent, r.amount, closedAt, now, rec.id).run();
    const row = await db.prepare("SELECT r.*, p.updated_at AS photo_at FROM d8_records r LEFT JOIN d8_recphotos p ON p.record_id = r.id WHERE r.id = ?").bind(rec.id).first();
    const before = JSON.parse(rec.data);
    const changed = Object.keys(r.data).filter((k) => String(before[k] ?? "") !== String(r.data[k] ?? ""));
    const parts = [];
    if (spec.amount && rec.amount !== r.amount) parts.push(`montant : ${fmt$(rec.amount)} → ${fmt$(r.amount)}`);
    if (rec.agent !== r.agent) parts.push(`agent : ${rec.agent || "—"} → ${r.agent}`);
    const others = changed.filter((k) => k !== spec.amount && k !== "agent");
    if (others.length) parts.push(`champs modifiés : ${others.join(", ")}`);
    if (photo) parts.push("capture remplacée");
    if (parts.length) await logAction(db, me, "modification", TYPE_LABEL[type], recordLabel(type, r.data), parts.join(" • "));
    return json(parseRow(row));
  }
  if (method === "DELETE") {
    if (!spec.perm && !can(me, "dossiers.supprimer")) fail(403, "Votre grade ne permet pas de supprimer des dossiers.");
    await db.batch([
      db.prepare("DELETE FROM d8_records WHERE id = ?").bind(rec.id),
      db.prepare("DELETE FROM d8_recphotos WHERE record_id = ?").bind(rec.id),
    ]);
    const d = JSON.parse(rec.data);
    await logAction(db, me, "suppression", TYPE_LABEL[type], recordLabel(type, d), [spec.amount && fmt$(rec.amount), rec.agent && `agent ${rec.agent}`, `créé par ${rec.created_by}`].filter(Boolean).join(" • "));
    return json({ ok: true });
  }
  fail(405, "Méthode non autorisée.");
}

/* ---------- chiffre d'affaires ---------- */

async function caBreakdown(db, since) {
  const { results } = await db.prepare(
    `SELECT agent, COUNT(*) AS count, SUM(amount) AS total,
            SUM(CASE WHEN type = 'ventes' THEN amount ELSE 0 END) AS ventes,
            SUM(CASE WHEN type = 'locations' THEN amount ELSE 0 END) AS locations
     FROM d8_records WHERE closed_at IS NOT NULL AND closed_at >= ? AND type IN ('ventes', 'locations')
     GROUP BY agent ORDER BY total DESC`
  ).bind(since).all();
  const dep = await db.prepare("SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM d8_records WHERE type = 'depenses' AND closed_at IS NOT NULL AND closed_at >= ?").bind(since).first();
  const sum = (k) => results.reduce((s, r) => s + (r[k] || 0), 0);
  const total = sum("total");
  return { employees: results, total, ventes: sum("ventes"), locations: sum("locations"), count: sum("count"), depenses: dep.total, depensesCount: dep.n, benefice: total - dep.total };
}

// Salaires : salaire max × (CA de l'employé ÷ objectif par employé), plafonné au max ; prime au(x) meilleur(s) vendeur(s).
async function payroll(db, b) {
  const get = async (k, d) => { const v = (await db.prepare("SELECT value FROM d8_settings WHERE key = ?").bind(k).first())?.value; return v === undefined || v === null || v === "" ? d : Number(v); };
  const max = await get("salaire_max", 250000), prime = await get("prime_meilleur", 50000), objectif = await get("objectif_employe", 0);
  const { results: users } = await db.prepare("SELECT username FROM d8_users").all();
  const rows = users.map((u) => { const e = b.employees.find((x) => x.agent === u.username); return { agent: u.username, total: e?.total || 0, count: e?.count || 0 }; });
  rows.sort((x, y) => y.total - x.total || y.count - x.count);
  const top = rows.length && rows[0].total > 0 ? rows[0].total : 0;
  for (const r of rows) {
    const ratio = objectif ? Math.min(1, r.total / objectif) : 0;
    r.rank = r.total > 0 ? rows.filter((o) => o.total > r.total).length + 1 : null;
    r.pct = objectif ? Math.round(ratio * 1000) / 10 : null;
    r.salaire = Math.round(max * ratio);
    r.best = top > 0 && r.total === top;
    r.prime = r.best ? prime : 0;
    r.aVerser = r.salaire + r.prime;
  }
  const s = (k) => rows.reduce((a, r) => a + r[k], 0);
  return { max, prime, objectif, rows, totalSalaires: s("salaire"), totalPrimes: s("prime"), totalAVerser: s("aVerser"), best: rows.filter((r) => r.best).map((r) => r.agent) };
}

async function ca(db, me, method, sub, id, body = {}) {
  const since = Number((await db.prepare("SELECT value FROM d8_settings WHERE key = 'ca_reset_at'").first())?.value || 0);
  const isManager = can(me, "ca.equipe");

  if (method === "GET" && !sub) {
    const b = await caBreakdown(db, since);
    const mine = b.employees.find((e) => e.agent === me.username) || { agent: me.username, count: 0, total: 0, ventes: 0, locations: 0 };
    const obj = async (k) => Number((await db.prepare("SELECT value FROM d8_settings WHERE key = ?").bind(k).first())?.value || 0);
    const out = { since, total: b.total, ventes: b.ventes, locations: b.locations, count: b.count, mine,
      objectifs: { entreprise: await obj("objectif_entreprise"), employe: await obj("objectif_employe") } };
    const pay = await payroll(db, b);
    out.paie = { max: pay.max, prime: pay.prime, objectif: pay.objectif, best: pay.best,
      mine: pay.rows.find((r) => r.agent === me.username) || null,
      classement: pay.rows.map((r) => (isManager || r.agent === me.username ? r : { agent: r.agent, rank: r.rank, count: r.count, best: r.best })) };
    if (isManager) Object.assign(out.paie, { totalSalaires: pay.totalSalaires, totalPrimes: pay.totalPrimes, totalAVerser: pay.totalAVerser });
    if (isManager || can(me, "depenses.gerer")) {
      Object.assign(out, { depenses: b.depenses, depensesCount: b.depensesCount, benefice: b.benefice });
      out.compte = await accountBalance(db);
    }
    if (isManager) {
      out.employees = b.employees;
      const { results } = await db.prepare("SELECT * FROM d8_ca_archives ORDER BY period_end DESC LIMIT 104").all();
      out.archives = results.map((a) => ({ ...a, details: JSON.parse(a.details) }));
    }
    return json(out);
  }

  if (!can(me, "ca.cloturer")) fail(403, "Votre grade ne permet pas de gérer le chiffre d'affaires.");

  if (method === "POST" && sub === "solde") {
    const montant = Number(String(body.montant ?? "").replace(/[\s\u00a0\u202f$€]/g, "").replace(",", "."));
    if (!Number.isFinite(montant) || Math.abs(montant) > 1e12) fail(400, "Montant invalide.");
    const before = await accountBalance(db);
    const now = Date.now();
    await db.batch([["solde_base", Math.round(montant)], ["solde_at", now]].map(([k, v]) =>
      db.prepare("INSERT INTO d8_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, String(v))));
    await logAction(db, me, "modification", "Compte", "Solde du compte", `${before ? `solde calculé ${fmt$(before.solde)} → ` : "solde de départ "}${fmt$(montant)}`);
    return json({ ok: true });
  }

  if (method === "POST" && sub === "objectifs") {
    const ent = cleanMoney(body.entreprise), emp = cleanMoney(body.employe);
    const pairs = [["objectif_entreprise", ent], ["objectif_employe", emp]];
    if (body.salaire_max !== undefined) pairs.push(["salaire_max", cleanMoney(body.salaire_max)]);
    if (body.prime_meilleur !== undefined) pairs.push(["prime_meilleur", cleanMoney(body.prime_meilleur)]);
    await db.batch(pairs.map(([k, v]) =>
      db.prepare("INSERT INTO d8_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, String(v))));
    await logAction(db, me, "modification", "Objectifs", "Objectifs et salaires", [`entreprise ${fmt$(ent)}`, `par employé ${fmt$(emp)}`, body.salaire_max !== undefined && `salaire max ${fmt$(cleanMoney(body.salaire_max))}`, body.prime_meilleur !== undefined && `prime ${fmt$(cleanMoney(body.prime_meilleur))}`].filter(Boolean).join(" • "));
    return json({ ok: true });
  }

  if (method === "POST" && sub === "reset") {
    const b = await caBreakdown(db, since);
    const now = Date.now();
    let start = since;
    if (!start) start = (await db.prepare("SELECT MIN(closed_at) AS m FROM d8_records WHERE closed_at IS NOT NULL").first())?.m || now;
    const pay = await payroll(db, b);
    const details = { ventes: b.ventes, locations: b.locations, count: b.count, employees: b.employees, depenses: b.depenses, benefice: b.benefice,
      paie: { max: pay.max, prime: pay.prime, objectif: pay.objectif, best: pay.best, totalAVerser: pay.totalAVerser,
        rows: pay.rows.filter((r) => r.aVerser > 0 || r.total > 0).map((r) => ({ agent: r.agent, total: r.total, salaire: r.salaire, prime: r.prime, aVerser: r.aVerser })) } };
    await db.batch([
      db.prepare("INSERT INTO d8_ca_archives (period_start, period_end, total, details, reset_by) VALUES (?, ?, ?, ?, ?)")
        .bind(start, now, b.total, JSON.stringify(details), me.username),
      db.prepare("INSERT INTO d8_settings (key, value) VALUES ('ca_reset_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(String(now)),
    ]);
    await logAction(db, me, "clôture", "CA", "Clôture de la semaine", `CA ${fmt$(b.total)} • dépenses ${fmt$(b.depenses)} • bénéfice ${fmt$(b.benefice)}${pay.best.length ? ` • meilleur vendeur : ${pay.best.join(", ")}` : ""} • salaires et primes ${fmt$(pay.totalAVerser)}`);
    return json({ ok: true, since: now });
  }
  if (method === "DELETE" && sub === "archives" && /^\d+$/.test(String(id))) {
    const a = await db.prepare("SELECT * FROM d8_ca_archives WHERE id = ?").bind(Number(id)).first();
    await db.prepare("DELETE FROM d8_ca_archives WHERE id = ?").bind(Number(id)).run();
    if (a) await logAction(db, me, "suppression", "CA", "Semaine archivée", `CA ${fmt$(a.total)} • du ${new Date(a.period_start).toLocaleDateString("fr-FR")} au ${new Date(a.period_end).toLocaleDateString("fr-FR")}`);
    return json({ ok: true });
  }
  fail(404, "Route introuvable.");
}

// Solde du compte = montant de départ + ventes/locations − dépenses enregistrées depuis
async function accountBalance(db) {
  const get = async (k) => (await db.prepare("SELECT value FROM d8_settings WHERE key = ?").bind(k).first())?.value;
  const at = Number(await get("solde_at") || 0);
  if (!at) return null;
  const base = Number(await get("solde_base") || 0);
  const r = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN type IN ('ventes', 'locations') THEN amount ELSE 0 END), 0) AS entrees,
            COALESCE(SUM(CASE WHEN type = 'depenses' THEN amount ELSE 0 END), 0) AS sorties
     FROM d8_records WHERE closed_at IS NOT NULL AND closed_at >= ?`
  ).bind(at).first();
  return { base, at, entrees: r.entrees, sorties: r.sorties, solde: base + r.entrees - r.sorties };
}

/* ---------- vitrine publique (sans connexion) ---------- */
// N'expose QUE les biens marqués visibles du catalogue et les coordonnées de l'agence.

const VITRINE_KEYS = ["vitrine_message", "vitrine_tel", "vitrine_adresse", "recrutement_ouvert", "recrutement_message"];
async function vitrineSettings(db) {
  const { results } = await db.prepare(`SELECT key, value FROM d8_settings WHERE key IN (${VITRINE_KEYS.map(() => "?").join(",")})`).bind(...VITRINE_KEYS).all();
  const m = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return { message: m.vitrine_message || "", tel: m.vitrine_tel || "", adresse: m.vitrine_adresse || "",
    recrutement: m.recrutement_ouvert === "1", recrutementMessage: m.recrutement_message || "" };
}

// Formulaires publics : rendez-vous et candidatures
const REQUEST_FORMS = {
  rdv: { nom: 60, telephone: 30, bien: 120, objet: 20, disponibilites: 200, message: 800 },
  candidature: { nom: 60, age: 10, telephone: 30, disponibilites: 200, experience: 1200, motivation: 1500, discord: 60 },
};
const REQUEST_STATUS = {
  rdv: ["Nouvelle", "Prise en charge", "Traitée", "Annulée"],
  candidature: ["Nouvelle", "Entretien prévu", "Acceptée", "Refusée"],
};

async function submitRequest(db, request, kind, body) {
  if (body.website) return json({ ok: true }); // piège à robots : champ invisible rempli
  if (kind === "candidature" && !(await vitrineSettings(db)).recrutement) fail(403, "Le recrutement est actuellement fermé.");
  const data = {};
  for (const [k, max] of Object.entries(REQUEST_FORMS[kind])) data[k] = cleanText(body[k], max);
  if (!data.nom || !data.telephone) fail(400, "Indiquez au moins votre nom et votre numéro de téléphone.");
  if (kind === "candidature" && !data.motivation) fail(400, "Expliquez-nous en quelques mots votre motivation.");
  if (kind === "rdv" && !["Achat", "Essai", "Reprise", "Autre"].includes(data.objet)) data.objet = "Autre";
  const ipHash = await sha256("d8|" + (request.headers.get("cf-connecting-ip") || "local"));
  const recent = (await db.prepare("SELECT COUNT(*) AS n FROM d8_requests WHERE ip_hash = ? AND created_at > ?").bind(ipHash, Date.now() - 3600000).first()).n;
  if (recent >= 5) fail(429, "Trop de demandes envoyées. Réessayez plus tard.");
  const now = Date.now();
  await db.prepare("INSERT INTO d8_requests (kind, data, statut, ip_hash, created_at, updated_at) VALUES (?, ?, 'Nouvelle', ?, ?, ?)")
    .bind(kind, JSON.stringify(data), ipHash, now, now).run();
  return json({ ok: true }, 201);
}

async function publicApi(db, request, method, what, id, body) {
  if (method === "POST" && (what === "rdv" || what === "candidature")) return await submitRequest(db, request, what, body);
  if (method !== "GET") fail(405, "Méthode non autorisée.");
  if (what === "catalog") {
    const { results } = await db.prepare(
      `SELECT c.id, c.nom, c.categorie, c.prix_vente, c.description, p.updated_at AS photo_at
       FROM d8_catalog c LEFT JOIN d8_photos p ON p.catalog_id = c.id WHERE c.public = 1 AND c.categorie = 'Occasion' AND c.prix_vente > 0 ORDER BY c.created_at DESC`
    ).all();
    const ev = (await db.prepare("SELECT id, titre, date, lieu, description FROM d8_events WHERE date >= ? ORDER BY date LIMIT 6").bind(Date.now() - 6 * 3600000).all()).results;
    return new Response(JSON.stringify({ items: results, vitrine: await vitrineSettings(db), events: ev }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30" },
    });
  }
  if (what === "photo" && /^\d+$/.test(String(id))) {
    const row = await db.prepare("SELECT p.data FROM d8_photos p JOIN d8_catalog c ON c.id = p.catalog_id WHERE c.id = ? AND c.public = 1 AND c.categorie = 'Occasion'").bind(Number(id)).first();
    if (!row) fail(404, "Photo introuvable.");
    const m = row.data.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) fail(404, "Photo introuvable.");
    const bin = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
    return new Response(bin, { headers: { "content-type": m[1], "cache-control": "public, max-age=86400" } });
  }
  fail(404, "Route introuvable.");
}

async function saveVitrine(db, me, body) {
  if (!can(me, "catalogue.gerer")) fail(403, "Votre grade ne permet pas de modifier la vitrine.");
  const v = { vitrine_message: cleanText(body.message, 400), vitrine_tel: cleanText(body.tel, 40), vitrine_adresse: cleanText(body.adresse, 120),
    recrutement_ouvert: body.recrutement ? "1" : "0", recrutement_message: cleanText(body.recrutementMessage, 600) };
  await db.batch(Object.entries(v).map(([k, val]) =>
    db.prepare("INSERT INTO d8_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, val)));
  await logAction(db, me, "modification", "Vitrine", "Réglages de la vitrine", [v.vitrine_tel && `tél. ${v.vitrine_tel}`, v.vitrine_adresse].filter(Boolean).join(" • "));
  return json({ ok: true });
}

/* ---------- catalogue des biens ---------- */

const MAX_PHOTO = 1500000; // ~1,1 Mo d'image

async function catalog(db, me, method, id, sub, body) {
  if (method === "GET" && !id) {
    const { results } = await db.prepare(
      "SELECT c.*, p.updated_at AS photo_at FROM d8_catalog c LEFT JOIN d8_photos p ON p.catalog_id = c.id ORDER BY c.nom COLLATE NOCASE"
    ).all();
    return json(results);
  }
  if (sub === "photo" && /^\d+$/.test(String(id))) {
    if (method === "GET") {
      const row = await db.prepare("SELECT data, updated_at FROM d8_photos WHERE catalog_id = ?").bind(Number(id)).first();
      if (!row) fail(404, "Pas de photo pour ce bien.");
      return json(row);
    }
    if (!can(me, "catalogue.gerer")) fail(403, "Votre grade ne permet pas de modifier les photos.");
    if (!(await db.prepare("SELECT 1 FROM d8_catalog WHERE id = ?").bind(Number(id)).first())) fail(404, "Bien introuvable.");
    if (method === "PUT") {
      const data = String(body.data || "");
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) fail(400, "Format d'image non pris en charge (JPG, PNG ou WEBP).");
      if (data.length > MAX_PHOTO) fail(400, "Photo trop lourde, choisissez une image plus petite.");
      const now = Date.now();
      await db.prepare("INSERT INTO d8_photos (catalog_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(catalog_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
        .bind(Number(id), data, now).run();
      return json({ ok: true, photo_at: now });
    }
    if (method === "DELETE") {
      await db.prepare("DELETE FROM d8_photos WHERE catalog_id = ?").bind(Number(id)).run();
      return json({ ok: true });
    }
    fail(405, "Méthode non autorisée.");
  }
  if (!can(me, "catalogue.gerer")) fail(403, "Votre grade ne permet pas de modifier le catalogue.");
  const clean = () => {
    const nom = cleanText(body.nom, 100);
    if (!nom) fail(400, "Le modèle du véhicule est obligatoire.");
    const vente = cleanMoney(body.prix_vente);
    const location = 0;
    if (!vente) fail(400, "Indiquez le prix du véhicule.");
    const categorie = String(body.categorie || "");
    if (!CATEGORIES.includes(categorie)) fail(400, "Choisissez : neuf ou occasion.");
    return { nom, vente, location, categorie, description: cleanText(body.description, 800), duree: "", visible: categorie === "Occasion" && !(body.public === false || body.public === 0) ? 1 : 0 };
  };
  if (method === "POST" && !id) {
    const c = clean();
    const r = await db.prepare("INSERT INTO d8_catalog (nom, prix_vente, prix_location, duree, categorie, public, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(c.nom, c.vente, c.location, c.duree, c.categorie, c.visible, c.description, Date.now()).run();
    await logAction(db, me, "création", "Véhicules", c.nom, `${c.categorie} • ${fmt$(c.vente)}${c.visible ? " • affiché en vitrine" : ""}`);
    return json({ id: r.meta.last_row_id }, 201);
  }
  if (!/^\d+$/.test(String(id))) fail(404, "Bien introuvable.");
  if (method === "PUT") {
    const c = clean();
    const old = await db.prepare("SELECT * FROM d8_catalog WHERE id = ?").bind(Number(id)).first();
    if (old && (old.prix_vente !== c.vente || old.prix_location !== c.location || old.nom !== c.nom || old.categorie !== c.categorie)) {
      await logAction(db, me, "modification", "Véhicules", c.nom, [old.nom !== c.nom && `modèle : ${old.nom} → ${c.nom}`, old.categorie !== c.categorie && `${old.categorie || "—"} → ${c.categorie}`, old.prix_vente !== c.vente && `prix : ${fmt$(old.prix_vente)} → ${fmt$(c.vente)}`].filter(Boolean).join(" • "));
    }
    await db.prepare("UPDATE d8_catalog SET nom = ?, prix_vente = ?, prix_location = ?, duree = ?, categorie = ?, public = ?, description = ? WHERE id = ?")
      .bind(c.nom, c.vente, c.location, c.duree, c.categorie, c.visible, c.description, Number(id)).run();
    return json({ ok: true });
  }
  if (method === "DELETE") {
    const old = await db.prepare("SELECT nom FROM d8_catalog WHERE id = ?").bind(Number(id)).first();
    if (old) await logAction(db, me, "suppression", "Véhicules", old.nom);
    await db.batch([
      db.prepare("DELETE FROM d8_photos WHERE catalog_id = ?").bind(Number(id)),
      db.prepare("DELETE FROM d8_catalog WHERE id = ?").bind(Number(id)),
    ]);
    return json({ ok: true });
  }
  fail(405, "Méthode non autorisée.");
}

/* ---------- grades & permissions ---------- */

function cleanGradeName(v) {
  const n = String(v ?? "").trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N} '’.-]{2,30}$/u.test(n)) fail(400, "Nom de grade invalide : 2 à 30 caractères (lettres, chiffres, espaces).");
  return n;
}
const cleanPerms = (v) => [...new Set((Array.isArray(v) ? v : []).filter((p) => PERMS.includes(p)))];

async function grades(db, me, method, name, sub, body) {
  if (method === "GET" && !name) {
    const { results } = await db.prepare(
      "SELECT g.name, g.position, g.permissions, (SELECT COUNT(*) FROM d8_users u WHERE u.grade = g.name) AS users FROM d8_grades g ORDER BY g.position"
    ).all();
    return json(results.map((g) => ({ ...g, permissions: g.name === "Directeur" ? [...PERMS] : cleanPerms(JSON.parse(g.permissions)) })));
  }
  if (!can(me, "grades.gerer")) fail(403, "Votre grade ne permet pas de gérer les grades.");

  if (method === "POST" && !name) {
    const n = cleanGradeName(body.name);
    if (await db.prepare("SELECT 1 FROM d8_grades WHERE name = ?").bind(n).first()) fail(409, "Ce grade existe déjà.");
    const pos = ((await db.prepare("SELECT MAX(position) AS m FROM d8_grades").first()).m ?? 0) + 1;
    await db.prepare("INSERT INTO d8_grades (name, position, permissions) VALUES (?, ?, ?)").bind(n, pos, JSON.stringify(cleanPerms(body.permissions))).run();
    await logAction(db, me, "création", "Grade", n, `${cleanPerms(body.permissions).length} permission(s)`);
    return json({ ok: true, name: n }, 201);
  }

  const g = name ? await db.prepare("SELECT * FROM d8_grades WHERE name = ?").bind(String(name)).first() : null;
  if (!g) fail(404, "Grade introuvable.");
  if (g.name === "Directeur") fail(400, "Le grade Directeur a toujours tous les droits : il ne peut être ni modifié, ni déplacé, ni supprimé.");

  if (method === "POST" && sub === "move") {
    const dir = Number(body.dir) < 0 ? -1 : 1;
    const other = await db.prepare(
      dir < 0 ? "SELECT * FROM d8_grades WHERE position < ? AND name != 'Directeur' ORDER BY position DESC LIMIT 1"
              : "SELECT * FROM d8_grades WHERE position > ? ORDER BY position ASC LIMIT 1"
    ).bind(g.position).first();
    if (other) {
      await db.batch([
        db.prepare("UPDATE d8_grades SET position = ? WHERE name = ?").bind(other.position, g.name),
        db.prepare("UPDATE d8_grades SET position = ? WHERE name = ?").bind(g.position, other.name),
      ]);
    }
    return json({ ok: true });
  }
  if (method === "PUT" && !sub) {
    const n = body.name !== undefined ? cleanGradeName(body.name) : g.name;
    if (n.toLowerCase() === "directeur") fail(400, "Ce nom est réservé.");
    if (n.toLowerCase() !== g.name.toLowerCase() && (await db.prepare("SELECT 1 FROM d8_grades WHERE name = ?").bind(n).first())) fail(409, "Ce grade existe déjà.");
    await db.batch([
      db.prepare("UPDATE d8_grades SET name = ?, permissions = ? WHERE name = ?").bind(n, JSON.stringify(cleanPerms(body.permissions)), g.name),
      db.prepare("UPDATE d8_users SET grade = ? WHERE grade = ?").bind(n, g.name),
    ]);
    const oldP = cleanPerms(JSON.parse(g.permissions)), newP = cleanPerms(body.permissions);
    const added = newP.filter((x) => !oldP.includes(x)), removed = oldP.filter((x) => !newP.includes(x));
    await logAction(db, me, "modification", "Grade", n, [n !== g.name && `renommé (ancien nom : ${g.name})`, added.length && `ajouté : ${added.join(", ")}`, removed.length && `retiré : ${removed.join(", ")}`].filter(Boolean).join(" • "));
    return json({ ok: true, name: n });
  }
  if (method === "DELETE" && !sub) {
    const n = (await db.prepare("SELECT COUNT(*) AS n FROM d8_users WHERE grade = ?").bind(g.name).first()).n;
    if (n) fail(400, `${n} employé(s) ont encore ce grade : changez-leur de grade avant de le supprimer.`);
    await db.prepare("DELETE FROM d8_grades WHERE name = ?").bind(g.name).run();
    await logAction(db, me, "suppression", "Grade", g.name);
    return json({ ok: true });
  }
  fail(405, "Méthode non autorisée.");
}

/* ---------- journal d'activité ---------- */

async function logs(db, me, url) {
  if (!can(me, "journal.voir")) fail(403, "Votre grade ne permet pas de consulter le journal.");
  await db.prepare("DELETE FROM d8_logs WHERE at < ?").bind(Date.now() - 120 * 24 * 3600 * 1000).run(); // conservé 4 mois
  const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
  const { results } = await db.prepare("SELECT * FROM d8_logs WHERE id < ? ORDER BY id DESC LIMIT 100").bind(before).all();
  return json(results);
}

/* ---------- demandes reçues (rendez-vous, candidatures) ---------- */

async function requests(db, me, method, id, body, url) {
  const permOf = (k) => (k === "candidature" ? "recrutement.gerer" : "rdv.gerer");
  if (method === "GET" && !id) {
    const kinds = ["rdv", "candidature"].filter((k) => can(me, permOf(k)));
    if (!kinds.length) fail(403, "Votre grade ne permet pas de consulter les demandes.");
    const { results } = await db.prepare(`SELECT id, kind, data, statut, assigned, notes, created_at, updated_at FROM d8_requests WHERE kind IN (${kinds.map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT 300`).bind(...kinds).all();
    return json(results.map((r) => ({ ...r, data: JSON.parse(r.data) })));
  }
  const r = /^\d+$/.test(String(id)) ? await db.prepare("SELECT * FROM d8_requests WHERE id = ?").bind(Number(id)).first() : null;
  if (!r) fail(404, "Demande introuvable.");
  if (!can(me, permOf(r.kind))) fail(403, "Votre grade ne permet pas de traiter cette demande.");
  const d = JSON.parse(r.data);
  const label = `${r.kind === "rdv" ? "Rendez-vous" : "Candidature"} de ${d.nom}`;
  if (method === "PATCH") {
    const statut = REQUEST_STATUS[r.kind].includes(body.statut) ? body.statut : r.statut;
    let assigned = r.assigned;
    if (body.assigned !== undefined) {
      assigned = cleanText(body.assigned, 32).toLowerCase() || null;
      if (assigned && !(await db.prepare("SELECT 1 FROM d8_users WHERE username = ?").bind(assigned).first())) fail(400, "Employé inconnu.");
    }
    const notes = body.notes !== undefined ? cleanText(body.notes, 2000) : r.notes;
    await db.prepare("UPDATE d8_requests SET statut = ?, assigned = ?, notes = ?, updated_at = ? WHERE id = ?").bind(statut, assigned, notes, Date.now(), r.id).run();
    const parts = [statut !== r.statut && `statut : ${r.statut} → ${statut}`, assigned !== r.assigned && `suivi par ${assigned || "personne"}`, notes !== r.notes && "notes modifiées"].filter(Boolean);
    if (parts.length) await logAction(db, me, "modification", "Demande", label, parts.join(" • "));
    return json({ ok: true });
  }
  if (method === "DELETE") {
    await db.prepare("DELETE FROM d8_requests WHERE id = ?").bind(r.id).run();
    await logAction(db, me, "suppression", "Demande", label, `statut ${r.statut}`);
    return json({ ok: true });
  }
  fail(405, "Méthode non autorisée.");
}

/* ---------- événements ---------- */

async function events(db, me, method, id, body) {
  if (method === "GET" && !id) {
    const { results } = await db.prepare("SELECT * FROM d8_events ORDER BY date DESC LIMIT 200").all();
    return json(results);
  }
  if (!can(me, "catalogue.gerer")) fail(403, "Votre grade ne permet pas de gérer les événements.");
  const clean = () => {
    const titre = cleanText(body.titre, 100);
    if (!titre) fail(400, "Le titre de l'événement est obligatoire.");
    const date = Number(body.date);
    if (!Number.isFinite(date) || date < 1e12) fail(400, "Date de l'événement invalide.");
    return { titre, date, lieu: cleanText(body.lieu, 120), description: cleanText(body.description, 800) };
  };
  if (method === "POST" && !id) {
    const e = clean();
    await db.prepare("INSERT INTO d8_events (titre, date, lieu, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(e.titre, e.date, e.lieu, e.description, me.username, Date.now()).run();
    await logAction(db, me, "création", "Événement", e.titre, new Date(e.date).toISOString().slice(0, 10));
    return json({ ok: true }, 201);
  }
  const ev = /^\d+$/.test(String(id)) ? await db.prepare("SELECT * FROM d8_events WHERE id = ?").bind(Number(id)).first() : null;
  if (!ev) fail(404, "Événement introuvable.");
  if (method === "PUT") {
    const e = clean();
    await db.prepare("UPDATE d8_events SET titre = ?, date = ?, lieu = ?, description = ? WHERE id = ?").bind(e.titre, e.date, e.lieu, e.description, ev.id).run();
    await logAction(db, me, "modification", "Événement", e.titre);
    return json({ ok: true });
  }
  if (method === "DELETE") {
    await db.prepare("DELETE FROM d8_events WHERE id = ?").bind(ev.id).run();
    await logAction(db, me, "suppression", "Événement", ev.titre);
    return json({ ok: true });
  }
  fail(405, "Méthode non autorisée.");
}

/* ---------- fiches employés (infos RP + carte d'identité RP) ---------- */
// Chaque employé peut remplir sa propre fiche ; « Gérer les comptes » voit et modifie toutes les fiches.
// La carte d'identité RP n'est visible que par l'employé lui-même et par « Gérer les comptes ».

const PROFILE_FIELDS = { naissance: 40, telephone: 30, embauche: 40, adresse: 120 };

async function profiles(db, me, method, username, sub, body) {
  const manager = can(me, "employes.gerer");
  const viewer = manager || can(me, "employes.voir");
  if (method === "GET" && !username) {
    const { results } = await db.prepare(
      "SELECT u.username, p.data, i.updated_at AS photo_at FROM d8_users u LEFT JOIN d8_profiles p ON p.username = u.username LEFT JOIN d8_idphotos i ON i.username = u.username"
    ).all();
    return json(results
      .filter((r) => viewer || r.username === me.username)
      .map((r) => {
        const data = r.data ? JSON.parse(r.data) : {};
        const mine = r.username === me.username;
        if (!manager) delete data.notes;
        return { username: r.username, data, photo_at: manager || mine ? r.photo_at : null };
      }));
  }
  const target = await db.prepare("SELECT username, display_name, grade FROM d8_users WHERE username = ?").bind(String(username || "").toLowerCase()).first();
  if (!target) fail(404, "Employé introuvable.");
  const mine = target.username === me.username;
  if (!manager && !mine) fail(403, "Vous ne pouvez modifier que votre propre fiche.");
  if (target.grade === "Directeur" && !mine && me.grade !== "Directeur") fail(403, "Seul un Directeur peut modifier la fiche d'un Directeur.");

  if (sub === "photo") {
    if (method === "GET") {
      const row = await db.prepare("SELECT data, updated_at FROM d8_idphotos WHERE username = ?").bind(target.username).first();
      if (!row) fail(404, "Pas de carte d'identité enregistrée.");
      return json(row);
    }
    if (method === "PUT") {
      const data = String(body.data || "");
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) fail(400, "Format d'image non pris en charge (JPG, PNG ou WEBP).");
      if (data.length > 1500000) fail(400, "Image trop lourde.");
      const now = Date.now();
      await db.prepare("INSERT INTO d8_idphotos (username, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(target.username, data, now).run();
      await logAction(db, me, "modification", "Fiche employé", target.display_name, "carte d'identité RP ajoutée");
      return json({ ok: true, photo_at: now });
    }
    if (method === "DELETE") {
      await db.prepare("DELETE FROM d8_idphotos WHERE username = ?").bind(target.username).run();
      await logAction(db, me, "modification", "Fiche employé", target.display_name, "carte d'identité RP retirée");
      return json({ ok: true });
    }
    fail(405, "Méthode non autorisée.");
  }
  if (method === "PUT" && !sub) {
    const old = await db.prepare("SELECT data FROM d8_profiles WHERE username = ?").bind(target.username).first();
    const prev = old ? JSON.parse(old.data) : {};
    const data = {};
    for (const [k, max] of Object.entries(PROFILE_FIELDS)) data[k] = cleanText(body[k], max);
    data.notes = manager ? cleanText(body.notes, 2000) : prev.notes || ""; // notes internes : direction uniquement
    await db.prepare("INSERT INTO d8_profiles (username, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(target.username, JSON.stringify(data), Date.now()).run();
    const changed = Object.keys(data).filter((k) => String(prev[k] || "") !== String(data[k] || ""));
    if (changed.length) await logAction(db, me, "modification", "Fiche employé", target.display_name, `champs : ${changed.join(", ")}`);
    return json({ ok: true });
  }
  fail(405, "Méthode non autorisée.");
}
