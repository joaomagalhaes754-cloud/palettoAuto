/**
 * Bot Discord de Paletto Auto : avis clients (/avis), tickets (/ticket-panel), demandes de rôle (/role-panel)
 * et absences (/absence-panel).
 *
 * - POST /api/discord        → reçoit les commandes et les clics envoyés par Discord (Interactions Endpoint URL)
 * - GET  /api/discord/setup  → enregistre (ou met à jour) les commandes auprès de Discord
 *
 * Tickets : la configuration (catégorie, rôle du personnel) est rangée dans l'identifiant du bouton,
 * et l'auteur du ticket dans le sujet du salon : aucune base de données n'est nécessaire.
 *
 * Secrets à définir dans Cloudflare (Worker → Settings → Variables and Secrets, type « Secret ») :
 *   DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN
 */

const GOLD = 0xc9a24a;
const NOTES = [
  [5, "⭐⭐⭐⭐⭐ Excellent"],
  [4, "⭐⭐⭐⭐ Très bien"],
  [3, "⭐⭐⭐ Correct"],
  [2, "⭐⭐ Décevant"],
  [1, "⭐ Mauvais"],
];

export const AVIS_COMMAND = {
  name: "avis",
  description: "Laisser un avis sur un vendeur de Paletto Auto",
  dm_permission: false,
  options: [
    { type: 3, name: "vendeur", description: "Nom du vendeur qui vous a servi", required: true, min_length: 2, max_length: 60 },
    { type: 4, name: "note", description: "Votre note", required: true, choices: NOTES.map(([value, name]) => ({ name, value })) },
    { type: 3, name: "commentaire", description: "Votre avis en quelques mots", required: true, min_length: 5, max_length: 500 },
  ],
};

export const TICKET_COMMAND = {
  name: "ticket-panel",
  description: "Publier le panneau d'ouverture de tickets dans ce salon",
  dm_permission: false,
  default_member_permissions: "32", // Gérer le serveur
  options: [
    { type: 8, name: "role", description: "Rôle du personnel qui voit et gère les tickets", required: true },
    { type: 7, name: "categorie", description: "Catégorie où créer les salons de ticket", required: false, channel_types: [4] },
  ],
};
export const ROLE_COMMAND = {
  name: "role-panel",
  description: "Publier le panneau de demande de rôles dans ce salon",
  dm_permission: false,
  default_member_permissions: "268435456", // Gérer les rôles
  options: [
    { type: 7, name: "salon", description: "Salon (réservé à l'équipe) où arrivent les demandes", required: true, channel_types: [0] },
    { type: 8, name: "validateur", description: "Seul ce rôle (et les administrateurs) peut accepter ou refuser", required: true },
    { type: 8, name: "role1", description: "Rôle pouvant être demandé", required: true },
    ...[2, 3, 4, 5].map((n) => ({ type: 8, name: `role${n}`, description: "Autre rôle pouvant être demandé", required: false })),
  ],
};
export const ABSENCE_COMMAND = {
  name: "absence-panel",
  description: "Publier le panneau de déclaration d'absence dans ce salon",
  dm_permission: false,
  default_member_permissions: "32", // Gérer le serveur
  options: [
    { type: 7, name: "salon", description: "Salon (réservé à la direction) où arrivent les absences", required: true, channel_types: [0] },
    { type: 8, name: "validateur", description: "Seul ce rôle (et les administrateurs) peut valider ou refuser", required: true },
  ],
};
export const COMMANDS = [AVIS_COMMAND, TICKET_COMMAND, ROLE_COMMAND, ABSENCE_COMMAND];

// Permissions Discord (bits)
const P = { MANAGE_ROLES: 1n << 28n, ADMIN: 1n << 3n, MANAGE_CHANNELS: 1n << 4n, VIEW: 1n << 10n, SEND: 1n << 11n, EMBED: 1n << 14n, ATTACH: 1n << 15n, HISTORY: 1n << 16n };
const MEMBER_ALLOW = String(P.VIEW | P.SEND | P.EMBED | P.ATTACH | P.HISTORY);
export const BOT_PERMISSIONS = String(P.MANAGE_CHANNELS | P.VIEW | P.SEND | P.EMBED | P.ATTACH | P.HISTORY | (1n << 28n)); // + Gérer les rôles

const SNOW = /^\d{5,25}$/;
const ephemeral = (content) => json({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

async function discordApi(env, method, path, body) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.message || `Discord ${res.status}`), { status: res.status, data });
  return data;
}
const editReply = (env, interaction, content) => fetch(
  `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`,
  { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) },
);
const explain = (e) => (e.status === 403 || e.status === 50013 || e.data?.code === 50013
  ? "le bot n'a pas les permissions nécessaires (Gérer les salons, Gérer les rôles, Voir/Envoyer des messages). Réinvitez-le avec le lien d'invitation complet ou vérifiez ses permissions dans la catégorie."
  : `erreur Discord (${e.message}).`);

function ticketPanel(interaction) {
  const opts = Object.fromEntries((interaction.data.options || []).map((o) => [o.name, o.value]));
  const role = SNOW.test(String(opts.role || "")) ? opts.role : "0";
  const cat = SNOW.test(String(opts.categorie || "")) ? opts.categorie : "0";
  return {
    embeds: [{
      title: "🎫 Support Paletto Auto",
      color: GOLD,
      description: "Une question sur un véhicule, une commande, une réclamation ou un partenariat ?\n\nCliquez sur **Ouvrir un ticket** : un salon privé est créé avec notre équipe.",
      footer: { text: "Paletto Auto • Un ticket par personne à la fois" },
    }],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: "Ouvrir un ticket", emoji: { name: "📩" }, custom_id: `t_open:${cat}:${role}` }] }],
  };
}

const ticketModal = (cat, role) => ({
  type: 9,
  data: {
    custom_id: `t_modal:${cat}:${role}`,
    title: "Ouvrir un ticket",
    components: [
      { type: 1, components: [{ type: 4, custom_id: "sujet", label: "Sujet", style: 1, min_length: 3, max_length: 80, required: true, placeholder: "ex. Achat d'un véhicule, réclamation, partenariat…" }] },
      { type: 1, components: [{ type: 4, custom_id: "details", label: "Détails", style: 2, max_length: 1000, required: false, placeholder: "Expliquez votre demande en quelques lignes" }] },
    ],
  },
});

async function openTicket(env, interaction, cat, role) {
  const user = interaction.member?.user || {};
  const fields = Object.fromEntries((interaction.data.components || []).flatMap((r) => r.components || []).map((c) => [c.custom_id, c.value]));
  const guild = interaction.guild_id;
  try {
    const channels = await discordApi(env, "GET", `/guilds/${guild}/channels`);
    const existing = channels.find((c) => c.type === 0 && String(c.topic || "").includes(`uid:${user.id}`));
    if (existing) return editReply(env, interaction, `Vous avez déjà un ticket ouvert : <#${existing.id}>`);
    const base = String(user.username || "client").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "client";
    const overwrites = [
      { id: guild, type: 0, deny: String(P.VIEW) },
      { id: user.id, type: 1, allow: MEMBER_ALLOW },
      { id: env.DISCORD_APPLICATION_ID, type: 1, allow: String(P.VIEW | P.SEND | P.EMBED | P.ATTACH | P.HISTORY | P.MANAGE_CHANNELS) },
    ];
    if (role !== "0") overwrites.push({ id: role, type: 0, allow: MEMBER_ALLOW });
    const ch = await discordApi(env, "POST", `/guilds/${guild}/channels`, {
      name: `ticket-${base}`,
      type: 0,
      ...(cat !== "0" ? { parent_id: cat } : {}),
      topic: `Ticket de ${user.username || "client"} • uid:${user.id}`,
      permission_overwrites: overwrites,
    });
    await discordApi(env, "POST", `/channels/${ch.id}/messages`, {
      content: `<@${user.id}>${role !== "0" ? ` <@&${role}>` : ""}`,
      allowed_mentions: { users: [user.id], roles: role !== "0" ? [role] : [] },
      embeds: [{
        title: `🎫 ${safe(fields.sujet, 80) || "Nouveau ticket"}`,
        color: GOLD,
        description: (fields.details ? `> ${safe(fields.details, 1000).replace(/\n+/g, "\n> ")}\n\n` : "") + "Un membre de l'équipe Paletto Auto va vous répondre ici. Quand la demande est réglée, cliquez sur **Fermer le ticket**.",
        footer: { text: `Ouvert par ${user.global_name || user.username || "client"}` },
        timestamp: new Date().toISOString(),
      }],
      components: [{ type: 1, components: [{ type: 2, style: 4, label: "Fermer le ticket", emoji: { name: "🔒" }, custom_id: `t_close:${user.id}:${role}` }] }],
    });
    return editReply(env, interaction, `✅ Votre ticket est ouvert : <#${ch.id}>`);
  } catch (e) {
    return editReply(env, interaction, `❌ Impossible d'ouvrir le ticket : ${explain(e)}`);
  }
}

// ----- Demandes de rôle -----
function rolePanel(interaction) {
  const opts = Object.fromEntries((interaction.data.options || []).map((o) => [o.name, o.value]));
  const resolved = interaction.data.resolved?.roles || {};
  const ids = [...new Set(["role1", "role2", "role3", "role4", "role5"].map((k) => opts[k]).filter((id) => SNOW.test(String(id || ""))))];
  const roles = ids.map((id) => ({ id, name: resolved[id]?.name || "Rôle" })).filter((r) => r.name !== "@everyone" && r.id !== interaction.guild_id);
  const valid = String(opts.validateur || "");
  if (!roles.length || !SNOW.test(String(opts.salon || "")) || !SNOW.test(valid) || valid === interaction.guild_id) return null;
  return {
    embeds: [{
      title: "🎭 Demande de rôle",
      color: GOLD,
      description: "Choisissez le rôle que vous souhaitez dans la liste ci-dessous et expliquez pourquoi.\nVotre demande sera examinée par l'équipe : vous recevrez la réponse en message privé.",
      fields: [{ name: "Rôles disponibles", value: roles.map((r) => `<@&${r.id}>`).join("\n") }],
    }],
    components: [{ type: 1, components: [{
      type: 3, custom_id: `r_pick:${opts.salon}:${valid}`, placeholder: "Choisir un rôle…", min_values: 1, max_values: 1,
      options: roles.map((r) => ({ label: r.name.slice(0, 100), value: r.id })),
    }] }],
    allowed_mentions: { parse: [] },
  };
}

const roleModal = (roleId, salon, valid, label) => ({
  type: 9,
  data: {
    custom_id: `r_modal:${roleId}:${salon}:${valid}`,
    title: `Demande : ${label}`.slice(0, 45),
    components: [{ type: 1, components: [{ type: 4, custom_id: "raison", label: "Pourquoi souhaitez-vous ce rôle ?", style: 2, min_length: 3, max_length: 500, required: true, placeholder: "ex. Je suis vendeur chez Paletto Auto depuis le 12/11" }] }],
  },
});

async function sendRoleRequest(env, interaction, roleId, salon, valid) {
  const user = interaction.member?.user || {};
  if ((interaction.member?.roles || []).includes(roleId)) return editReply(env, interaction, "Vous avez déjà ce rôle.");
  const raison = (interaction.data.components || []).flatMap((r) => r.components || []).find((c) => c.custom_id === "raison")?.value;
  try {
    await discordApi(env, "POST", `/channels/${salon}/messages`, {
      embeds: [{
        title: "🎭 Nouvelle demande de rôle",
        color: GOLD,
        fields: [
          { name: "Membre", value: `<@${user.id}> (${safe(user.global_name || user.username, 80)})`, inline: true },
          { name: "Rôle demandé", value: `<@&${roleId}>`, inline: true },
          { name: "Raison", value: safe(raison, 500) || "—" },
          { name: "Peut valider", value: `<@&${valid}> et les administrateurs` },
        ],
        timestamp: new Date().toISOString(),
      }],
      components: [{ type: 1, components: [
        { type: 2, style: 3, label: "Accepter", emoji: { name: "✅" }, custom_id: `r_ok:${user.id}:${roleId}:${valid}` },
        { type: 2, style: 4, label: "Refuser", emoji: { name: "✖️" }, custom_id: `r_no:${user.id}:${roleId}:${valid}` },
      ] }],
      allowed_mentions: { parse: [] },
    });
    return editReply(env, interaction, "✅ Demande envoyée à l'équipe. Vous recevrez la réponse en message privé.");
  } catch (e) {
    return editReply(env, interaction, `❌ Impossible d'envoyer la demande : ${explain(e)}`);
  }
}

async function decideRole(env, interaction, userId, roleId, accept) {
  const staff = interaction.member?.nick || interaction.member?.user?.global_name || interaction.member?.user?.username || "l'équipe";
  const followUp = (content) => fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content, flags: 64 }),
  });
  if (accept) {
    try {
      await discordApi(env, "PUT", `/guilds/${interaction.guild_id}/members/${userId}/roles/${roleId}`);
    } catch (e) {
      const why = e.status === 403 ? "le rôle du bot doit être placé AU-DESSUS de ce rôle (Paramètres du serveur → Rôles), et le bot doit avoir « Gérer les rôles »." : e.status === 404 ? "ce membre n'est plus sur le serveur." : `erreur Discord (${e.message}).`;
      return followUp(`❌ Rôle non attribué : ${why}`);
    }
  }
  const old = interaction.message?.embeds?.[0] || {};
  await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      embeds: [{ ...old, title: accept ? "✅ Demande de rôle acceptée" : "✖️ Demande de rôle refusée", color: accept ? 0x3ba55c : 0xa83c3c,
        fields: [...(old.fields || []), { name: "Décision", value: `${accept ? "Acceptée" : "Refusée"} par ${safe(staff, 80)}` }] }],
      components: [], allowed_mentions: { parse: [] },
    }),
  });
  try { // message privé au membre (ignoré s'il a fermé ses MP)
    const dm = await discordApi(env, "POST", "/users/@me/channels", { recipient_id: userId });
    await discordApi(env, "POST", `/channels/${dm.id}/messages`, {
      content: accept ? `✅ Votre demande de rôle a été **acceptée** par ${safe(staff, 80)}. Le rôle vous a été attribué.` : `✖️ Votre demande de rôle a été **refusée** par ${safe(staff, 80)}. N'hésitez pas à contacter l'équipe pour en savoir plus.`,
    });
  } catch { /* MP fermés */ }
}

// ----- Absences -----
function absencePanel(interaction) {
  const opts = Object.fromEntries((interaction.data.options || []).map((o) => [o.name, o.value]));
  const salon = String(opts.salon || ""), valid = String(opts.validateur || "");
  if (!SNOW.test(salon) || !SNOW.test(valid) || valid === interaction.guild_id) return null;
  return {
    embeds: [{
      title: "📅 Déclarer une absence",
      color: GOLD,
      description: "Vous serez absent ? Prévenez la direction en cliquant sur **Déclarer une absence**.\nIndiquez les dates et le motif : vous recevrez la réponse en message privé.",
      footer: { text: "Paletto Auto • Merci de prévenir le plus tôt possible" },
    }],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: "Déclarer une absence", emoji: { name: "📅" }, custom_id: `a_open:${salon}:${valid}` }] }],
  };
}

const absenceModal = (salon, valid) => ({
  type: 9,
  data: {
    custom_id: `a_modal:${salon}:${valid}`,
    title: "Déclarer une absence",
    components: [
      { type: 1, components: [{ type: 4, custom_id: "debut", label: "Du (date de début)", style: 1, min_length: 2, max_length: 30, required: true, placeholder: "ex. 20/11" }] },
      { type: 1, components: [{ type: 4, custom_id: "fin", label: "Au (date de retour)", style: 1, min_length: 2, max_length: 30, required: true, placeholder: "ex. 27/11" }] },
      { type: 1, components: [{ type: 4, custom_id: "motif", label: "Motif", style: 2, min_length: 3, max_length: 500, required: true, placeholder: "ex. Vacances, examens, raisons personnelles…" }] },
    ],
  },
});

async function sendAbsence(env, interaction, salon, valid) {
  const user = interaction.member?.user || {};
  const f = Object.fromEntries((interaction.data.components || []).flatMap((r) => r.components || []).map((c) => [c.custom_id, c.value]));
  try {
    await discordApi(env, "POST", `/channels/${salon}/messages`, {
      embeds: [{
        title: "📅 Nouvelle absence déclarée",
        color: GOLD,
        fields: [
          { name: "Employé", value: `<@${user.id}> (${safe(interaction.member?.nick || user.global_name || user.username, 80)})` },
          { name: "Du", value: safe(f.debut, 30) || "—", inline: true },
          { name: "Au", value: safe(f.fin, 30) || "—", inline: true },
          { name: "Motif", value: safe(f.motif, 500) || "—" },
          { name: "Peut valider", value: `<@&${valid}> et les administrateurs` },
        ],
        timestamp: new Date().toISOString(),
      }],
      components: [{ type: 1, components: [
        { type: 2, style: 3, label: "Valider", emoji: { name: "✅" }, custom_id: `a_ok:${user.id}:0:${valid}` },
        { type: 2, style: 4, label: "Refuser", emoji: { name: "✖️" }, custom_id: `a_no:${user.id}:0:${valid}` },
      ] }],
      allowed_mentions: { parse: [] },
    });
    return editReply(env, interaction, "✅ Absence envoyée à la direction. Vous recevrez la réponse en message privé.");
  } catch (e) {
    return editReply(env, interaction, `❌ Impossible d'envoyer l'absence : ${explain(e)}`);
  }
}

async function decideAbsence(env, interaction, userId, accept) {
  const staff = interaction.member?.nick || interaction.member?.user?.global_name || interaction.member?.user?.username || "la direction";
  const old = interaction.message?.embeds?.[0] || {};
  const dates = (old.fields || []).filter((x) => x.name === "Du" || x.name === "Au").map((x) => x.value);
  await fetch(`https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      embeds: [{ ...old, title: accept ? "✅ Absence validée" : "✖️ Absence refusée", color: accept ? 0x3ba55c : 0xa83c3c,
        fields: [...(old.fields || []).filter((x) => x.name !== "Peut valider"), { name: "Décision", value: `${accept ? "Validée" : "Refusée"} par ${safe(staff, 80)}` }] }],
      components: [], allowed_mentions: { parse: [] },
    }),
  });
  try {
    const dm = await discordApi(env, "POST", "/users/@me/channels", { recipient_id: userId });
    const periode = dates.length === 2 ? ` (du ${dates[0]} au ${dates[1]})` : "";
    await discordApi(env, "POST", `/channels/${dm.id}/messages`, {
      content: accept ? `✅ Votre absence${periode} a été **validée** par ${safe(staff, 80)}. Bon repos !` : `✖️ Votre absence${periode} a été **refusée** par ${safe(staff, 80)}. Contactez la direction pour en parler.`,
    });
  } catch { /* MP fermés */ }
}

function isValidatorOf(interaction, valid) {
  const perms = BigInt(interaction.member?.permissions || "0");
  return (perms & P.ADMIN) !== 0n || (valid !== "0" && (interaction.member?.roles || []).includes(valid));
}

function canClose(interaction, opener, role) {
  const m = interaction.member || {};
  const perms = BigInt(m.permissions || "0");
  return m.user?.id === opener || (role !== "0" && (m.roles || []).includes(role)) || (perms & P.ADMIN) !== 0n || (perms & P.MANAGE_CHANNELS) !== 0n;
}

const hexToBytes = (hex) => {
  const clean = String(hex || "").trim();
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2) return new Uint8Array();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
};

async function isFromDiscord(request, env, body) {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp || !env.DISCORD_PUBLIC_KEY) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(env.DISCORD_PUBLIC_KEY), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hexToBytes(signature), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const page = (title, text, ok) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
  <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a08;color:#f2ede3;font-family:system-ui,sans-serif">
  <div style="max-width:520px;padding:32px;border:1px solid ${ok ? "#c9a24a" : "#8a3a3a"};border-radius:6px;line-height:1.6">
  <h1 style="margin:0 0 12px;font-size:20px;color:${ok ? "#e6c77c" : "#e08a8a"}">${title}</h1><p style="margin:0">${text}</p></div></body>`,
  { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
);

// Neutralise les mentions et la mise en forme pour qu'un avis ne puisse pas pinger ni casser l'affichage.
const safe = (s, max) => String(s || "").replace(/@(everyone|here)/gi, "@​$1").replace(/([*_~`|>])/g, "\\$1").trim().slice(0, max);

function reviewEmbed(interaction) {
  const opts = Object.fromEntries((interaction.data.options || []).map((o) => [o.name, o.value]));
  const note = Math.min(5, Math.max(1, Number(opts.note) || 0));
  const user = interaction.member?.user || interaction.user || {};
  const auteur = interaction.member?.nick || user.global_name || user.username || "Client";
  return {
    title: "Nouvel avis client",
    color: GOLD,
    description: `> ${safe(opts.commentaire, 500).replace(/\n+/g, "\n> ")}`,
    fields: [
      { name: "Vendeur", value: safe(opts.vendeur, 60) || "—", inline: true },
      { name: "Note", value: `${"★".repeat(note)}${"☆".repeat(5 - note)}  (${note}/5)`, inline: true },
    ],
    footer: { text: `Avis laissé par ${String(auteur).slice(0, 80)} • Paletto Auto` },
    timestamp: new Date().toISOString(),
  };
}

async function setup(env) {
  const missing = ["DISCORD_APPLICATION_ID", "DISCORD_PUBLIC_KEY", "DISCORD_BOT_TOKEN"].filter((k) => !env[k]);
  if (missing.length) return page("Configuration incomplète", `Ajoutez ces secrets dans Cloudflare (Worker → Settings → Variables and Secrets) puis redéployez : <b>${missing.join(", ")}</b>.`, false);
  const res = await fetch(`https://discord.com/api/v10/applications/${env.DISCORD_APPLICATION_ID}/commands`, {
    method: "PUT",
    headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(COMMANDS),
  });
  if (!res.ok) {
    const detail = res.status === 401 ? "le token du bot est refusé (vérifiez DISCORD_BOT_TOKEN)." : res.status === 404 || res.status === 403 ? "l'Application ID ne correspond pas au bot (vérifiez DISCORD_APPLICATION_ID)." : `erreur Discord ${res.status}.`;
    return page("Échec de l'enregistrement", `La commande n'a pas pu être enregistrée : ${detail}`, false);
  }
  const invite = `https://discord.com/oauth2/authorize?client_id=${env.DISCORD_APPLICATION_ID}&scope=bot+applications.commands&permissions=${BOT_PERMISSIONS}`;
  return page("Commandes /avis, /ticket-panel, /role-panel et /absence-panel enregistrées ✓", `Les commandes sont prêtes. Pour les tickets, le bot doit pouvoir créer des salons : (ré)invitez-le avec ce lien, qui lui donne les bonnes permissions :<br><a style="color:#e6c77c;word-break:break-all" href="${invite}">${invite}</a><br><br>Ensuite : <b>/ticket-panel</b> dans le salon de support, <b>/role-panel</b> dans le salon des demandes de rôle, <b>/absence-panel</b> dans le salon des employés. Pensez à placer le rôle du bot au-dessus des rôles qu'il doit donner (Paramètres du serveur → Rôles).`, true);
}

export async function handleDiscord(request, env, path, ctx) {
  if (path[1] === "setup" && request.method === "GET") return setup(env);
  if (path.length > 1 || request.method !== "POST") return json({ error: "Route inconnue." }, 404);

  const body = await request.text();
  if (!(await isFromDiscord(request, env, body))) return new Response("Signature invalide.", { status: 401 });

  let interaction;
  try { interaction = JSON.parse(body); } catch { return new Response("JSON invalide.", { status: 400 }); }

  if (interaction.type === 1) return json({ type: 1 }); // PING de vérification de Discord

  if (interaction.type === 2 && interaction.data?.name === "avis") {
    return json({ type: 4, data: { embeds: [reviewEmbed(interaction)], allowed_mentions: { parse: [] } } });
  }

  // ----- Tickets -----
  if (interaction.type === 2 && interaction.data?.name === "ticket-panel") {
    if (!env.DISCORD_BOT_TOKEN) return ephemeral("Le token du bot n'est pas configuré.");
    const panel = ticketPanel(interaction);
    ctx.waitUntil(discordApi(env, "POST", `/channels/${interaction.channel_id}/messages`, panel)
      .then(() => editReply(env, interaction, "✅ Panneau de tickets publié dans ce salon."))
      .catch((e) => editReply(env, interaction, `❌ Impossible de publier le panneau : ${explain(e)}`)));
    return json({ type: 5, data: { flags: 64 } });
  }
  const cid = String(interaction.data?.custom_id || "");
  const [kind, a = "0", b = "0", c = "0"] = cid.split(":");
  if (![a, b, c].every((x) => x === "0" || SNOW.test(x))) return ephemeral("Bouton invalide.");
  if (interaction.type === 3 && kind === "t_open") return json(ticketModal(a, b));
  if (interaction.type === 5 && kind === "t_modal") {
    ctx.waitUntil(openTicket(env, interaction, a, b));
    return json({ type: 5, data: { flags: 64 } });
  }
  if (interaction.type === 2 && interaction.data?.name === "role-panel") {
    if (!env.DISCORD_BOT_TOKEN) return ephemeral("Le token du bot n'est pas configuré.");
    const panel = rolePanel(interaction);
    if (!panel) return ephemeral("Choisissez un salon, un rôle validateur et au moins un rôle demandable (pas @everyone).");
    ctx.waitUntil(discordApi(env, "POST", `/channels/${interaction.channel_id}/messages`, panel)
      .then(() => editReply(env, interaction, "✅ Panneau de demande de rôles publié dans ce salon."))
      .catch((e) => editReply(env, interaction, `❌ Impossible de publier le panneau : ${explain(e)}`)));
    return json({ type: 5, data: { flags: 64 } });
  }
  if (interaction.type === 3 && kind === "r_pick") {
    const roleId = String(interaction.data.values?.[0] || "");
    if (!SNOW.test(roleId)) return ephemeral("Rôle invalide.");
    if ((interaction.member?.roles || []).includes(roleId)) return ephemeral("Vous avez déjà ce rôle.");
    const label = (interaction.message?.components || []).flatMap((r) => r.components || []).flatMap((c) => c.options || []).find((o) => o.value === roleId)?.label || "rôle";
    return json(roleModal(roleId, a, b, label));
  }
  if (interaction.type === 5 && kind === "r_modal") {
    ctx.waitUntil(sendRoleRequest(env, interaction, a, b, c));
    return json({ type: 5, data: { flags: 64 } });
  }
  if (interaction.type === 3 && (kind === "r_ok" || kind === "r_no")) {
    const perms = BigInt(interaction.member?.permissions || "0");
    const isAdmin = (perms & P.ADMIN) !== 0n;
    const isValidator = c !== "0" && (interaction.member?.roles || []).includes(c);
    if (!isAdmin && !isValidator) return ephemeral(c !== "0" ? `Seuls les membres <@&${c}> et les administrateurs peuvent accepter ou refuser cette demande.` : "Seuls les administrateurs peuvent traiter cette demande.");
    ctx.waitUntil(decideRole(env, interaction, a, b, kind === "r_ok"));
    return json({ type: 6 });
  }
  if (interaction.type === 2 && interaction.data?.name === "absence-panel") {
    if (!env.DISCORD_BOT_TOKEN) return ephemeral("Le token du bot n'est pas configuré.");
    const panel = absencePanel(interaction);
    if (!panel) return ephemeral("Choisissez un salon et un rôle validateur (pas @everyone).");
    ctx.waitUntil(discordApi(env, "POST", `/channels/${interaction.channel_id}/messages`, panel)
      .then(() => editReply(env, interaction, "✅ Panneau des absences publié dans ce salon."))
      .catch((e) => editReply(env, interaction, `❌ Impossible de publier le panneau : ${explain(e)}`)));
    return json({ type: 5, data: { flags: 64 } });
  }
  if (interaction.type === 3 && kind === "a_open") return json(absenceModal(a, b));
  if (interaction.type === 5 && kind === "a_modal") {
    ctx.waitUntil(sendAbsence(env, interaction, a, b));
    return json({ type: 5, data: { flags: 64 } });
  }
  if (interaction.type === 3 && (kind === "a_ok" || kind === "a_no")) {
    if (!isValidatorOf(interaction, c)) return ephemeral(`Seuls les membres <@&${c}> et les administrateurs peuvent valider ou refuser une absence.`);
    ctx.waitUntil(decideAbsence(env, interaction, a, kind === "a_ok"));
    return json({ type: 6 });
  }
  if (interaction.type === 3 && kind === "t_close") {
    if (!canClose(interaction, a, b)) return ephemeral("Seul l'auteur du ticket ou l'équipe peut le fermer.");
    const who = interaction.member?.nick || interaction.member?.user?.global_name || interaction.member?.user?.username || "un membre";
    ctx.waitUntil(new Promise((r) => setTimeout(r, 5000)).then(() => discordApi(env, "DELETE", `/channels/${interaction.channel_id}`)).catch(() => {}));
    return json({ type: 4, data: { content: `🔒 Ticket fermé par **${safe(who, 80)}**. Ce salon sera supprimé dans 5 secondes.`, allowed_mentions: { parse: [] } } });
  }
  return json({ type: 4, data: { content: "Commande inconnue.", flags: 64 } });
}
