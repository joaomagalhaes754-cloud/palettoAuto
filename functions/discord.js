/**
 * Bot Discord de Paletto Auto : avis clients (/avis) et tickets (/ticket-panel + boutons).
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
export const COMMANDS = [AVIS_COMMAND, TICKET_COMMAND];

// Permissions Discord (bits)
const P = { ADMIN: 1n << 3n, MANAGE_CHANNELS: 1n << 4n, VIEW: 1n << 10n, SEND: 1n << 11n, EMBED: 1n << 14n, ATTACH: 1n << 15n, HISTORY: 1n << 16n };
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
  return page("Commandes /avis et /ticket-panel enregistrées ✓", `Les commandes sont prêtes. Pour les tickets, le bot doit pouvoir créer des salons : (ré)invitez-le avec ce lien, qui lui donne les bonnes permissions :<br><a style="color:#e6c77c;word-break:break-all" href="${invite}">${invite}</a><br><br>Ensuite, dans le salon de support, tapez <b>/ticket-panel</b> et choisissez le rôle de votre équipe.`, true);
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
  const [kind, a = "0", b = "0"] = cid.split(":");
  if (![a, b].every((x) => x === "0" || SNOW.test(x))) return ephemeral("Bouton invalide.");
  if (interaction.type === 3 && kind === "t_open") return json(ticketModal(a, b));
  if (interaction.type === 5 && kind === "t_modal") {
    ctx.waitUntil(openTicket(env, interaction, a, b));
    return json({ type: 5, data: { flags: 64 } });
  }
  if (interaction.type === 3 && kind === "t_close") {
    if (!canClose(interaction, a, b)) return ephemeral("Seul l'auteur du ticket ou l'équipe peut le fermer.");
    const who = interaction.member?.nick || interaction.member?.user?.global_name || interaction.member?.user?.username || "un membre";
    ctx.waitUntil(new Promise((r) => setTimeout(r, 5000)).then(() => discordApi(env, "DELETE", `/channels/${interaction.channel_id}`)).catch(() => {}));
    return json({ type: 4, data: { content: `🔒 Ticket fermé par **${safe(who, 80)}**. Ce salon sera supprimé dans 5 secondes.`, allowed_mentions: { parse: [] } } });
  }
  return json({ type: 4, data: { content: "Commande inconnue.", flags: 64 } });
}
