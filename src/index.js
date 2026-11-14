/**
 * Point d'entrée pour Cloudflare Workers.
 * - /api/*  → l'API (fichier functions/api/[[path]].js)
 * - le reste → les fichiers du dossier public/
 */
import { onRequest } from "../functions/api/[[path]].js";
import { handleDiscord } from "../functions/discord.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const path = url.pathname.slice(5).split("/").filter(Boolean).map((p) => {
        try { return decodeURIComponent(p); } catch { return p; }
      });
      if (path[0] === "discord") return handleDiscord(request, env, path, ctx); // bot Discord « avis clients »
      return onRequest({ request, env, params: { path }, waitUntil: ctx.waitUntil.bind(ctx) });
    }
    return env.ASSETS.fetch(request);
  },
};
