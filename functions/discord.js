/**
 * Bot Discord « Avis clients » de Paletto Auto (commande /avis).
 *
 * - POST /api/discord        → reçoit les commandes envoyées par Discord (Interactions Endpoint URL)
 * - GET  /api/discord/setup  → enregistre (ou met à jour) la commande /avis auprès de Discord
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
    body: JSON.stringify([AVIS_COMMAND]),
  });
  if (!res.ok) {
    const detail = res.status === 401 ? "le token du bot est refusé (vérifiez DISCORD_BOT_TOKEN)." : res.status === 404 || res.status === 403 ? "l'Application ID ne correspond pas au bot (vérifiez DISCORD_APPLICATION_ID)." : `erreur Discord ${res.status}.`;
    return page("Échec de l'enregistrement", `La commande n'a pas pu être enregistrée : ${detail}`, false);
  }
  return page("Commande /avis enregistrée ✓", "La commande est prête. Dernière étape : collez l'adresse <b>/api/discord</b> de ce site dans « Interactions Endpoint URL » sur le portail Discord, puis invitez le bot sur votre serveur. La commande peut mettre quelques minutes à apparaître.", true);
}

export async function handleDiscord(request, env, path) {
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
  return json({ type: 4, data: { content: "Commande inconnue.", flags: 64 } });
}
